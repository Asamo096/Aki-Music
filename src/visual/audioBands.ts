// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 音频频段计算（纯函数，供 audioBus 与单测使用）。
 *
 * 算法移植自 folia-major（AGPL-3.0）：
 *   - 频段划分与幂压缩：src/hooks/usePlaybackVisualizerBridge.ts
 *   - 起音/释放平滑参数：src/components/visualizer/lumiere/lumiereAudio.ts
 *
 * 约定：原始频段值与输出都在 0..255；power/bands 只驱动运动与亮度，
 * 不参与色相（色相来自封面主题）。
 */

export interface AudioBands {
  bass: number;
  lowMid: number;
  mid: number;
  vocal: number;
  treble: number;
}

export interface AudioFrame {
  /** 综合能量 0..255（低频为主） */
  power: number;
  bands: AudioBands;
  /** 当前是否有真实信号（分析不可用或静音时为 false） */
  active: boolean;
  updatedAt: number;
}

/** 频段边界（Hz），与 folia 一致 */
export const BAND_RANGES = {
  bass: [20, 150],
  lowMid: [150, 400],
  mid: [400, 1200],
  vocal: [1000, 3500],
  treble: [3500, 12000],
} as const;

/** 无信号时的“呼吸”上限（0..40），避免背景完全死掉 */
export const IDLE_BREATH_MAX = 40;

/** 起音/释放时间常数（秒），与 folia 的 lumiereAudio 一致 */
export const ATTACK_SECONDS = 0.06;
export const RELEASE_SECONDS = 0.25;

const ZERO_BANDS: AudioBands = {
  bass: 0,
  lowMid: 0,
  mid: 0,
  vocal: 0,
  treble: 0,
};

/**
 * 无信号/暂停时的呼吸帧。
 * 注意：这是“没有分析数据”的兜底，不是静音检测——播放中的真实静音返回 0。
 */
export const createIdleFrame = (now = 0): AudioFrame => {
  const breath = (Math.sin(now / 2000) + 1) * (IDLE_BREATH_MAX / 2);
  return {
    power: breath,
    bands: {
      bass: breath,
      lowMid: breath,
      mid: breath,
      vocal: breath,
      treble: breath,
    },
    active: false,
    updatedAt: now,
  };
};

/** 频段对应的 FFT bin 区间（闭区间）；数据为空或参数非法时返回 null */
export const getBinRange = (
  minHz: number,
  maxHz: number,
  binHz: number,
  length: number
): [number, number] | null => {
  if (!length || !Number.isFinite(binHz) || binHz <= 0) return null;
  if (!Number.isFinite(minHz) || !Number.isFinite(maxHz) || maxHz < minHz) {
    return null;
  }
  const start = Math.max(0, Math.floor(minHz / binHz));
  const end = Math.min(length - 1, Math.floor(maxHz / binHz));
  if (end < start) return null;
  return [start, end];
};

/** 某一频段内的平均能量（0..255） */
export const getEnergy = (
  data: Uint8Array,
  minHz: number,
  maxHz: number,
  binHz: number
): number => {
  const range = getBinRange(minHz, maxHz, binHz, data.length);
  if (!range) return 0;
  const [start, end] = range;
  let sum = 0;
  for (let index = start; index <= end; index += 1) sum += data[index];
  return sum / (end - start + 1);
};

/** 幂压缩：让鼓点更突出（输入 0..255，输出 0..255） */
export const processBand = (value: number, boost: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const normalized = Math.min(1, value / 255);
  return Math.pow(normalized, boost) * 255;
};

/** 一阶低通：起音快、释放慢，避免逐帧抖动导致闪烁 */
export const smoothBand = (
  current: number,
  target: number,
  dt: number,
  attack = ATTACK_SECONDS,
  release = RELEASE_SECONDS
): number => {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const tau = target > current ? attack : release;
  const alpha = 1 - Math.exp(-dt / Math.max(1e-3, tau));
  return current + (target - current) * alpha;
};

/**
 * 从一帧 FFT 数据计算输出帧。
 * 全 0 数据视为“正在播放但静音”：active=false、power=0（不用呼吸值）。
 */
export const computeFrame = (
  data: Uint8Array,
  binHz: number,
  now: number,
  previous?: AudioFrame | null,
  dt = 0
): AudioFrame => {
  if (!data.length) return createIdleFrame(now);

  const rawBass = getEnergy(
    data,
    BAND_RANGES.bass[0],
    BAND_RANGES.bass[1],
    binHz
  );
  const rawLowMid = getEnergy(
    data,
    BAND_RANGES.lowMid[0],
    BAND_RANGES.lowMid[1],
    binHz
  );
  const rawMid = getEnergy(data, BAND_RANGES.mid[0], BAND_RANGES.mid[1], binHz);
  const rawVocal = getEnergy(
    data,
    BAND_RANGES.vocal[0],
    BAND_RANGES.vocal[1],
    binHz
  );
  const rawTreble = getEnergy(
    data,
    BAND_RANGES.treble[0],
    BAND_RANGES.treble[1],
    binHz
  );

  const peak = Math.max(rawBass, rawLowMid, rawMid, rawVocal, rawTreble);
  if (peak <= 0) {
    return {
      power: 0,
      bands: { ...ZERO_BANDS },
      active: false,
      updatedAt: now,
    };
  }

  const targets: AudioBands = {
    bass: processBand(rawBass, 1.8),
    lowMid: processBand(rawLowMid, 2),
    mid: processBand(rawMid, 2),
    vocal: processBand(rawVocal, 1.5),
    treble: processBand(rawTreble, 2),
  };
  const powerTarget = processBand((rawBass + rawLowMid) / 2, 3);

  // 第一帧没有历史值：直接取目标，避免从 0 慢慢爬（视觉上会"慢半拍"）
  const prev = previous ?? null;
  if (!prev) {
    return {
      power: powerTarget,
      bands: targets,
      active: true,
      updatedAt: now,
    };
  }

  const bands: AudioBands = {
    bass: smoothBand(prev.bands.bass, targets.bass, dt),
    lowMid: smoothBand(prev.bands.lowMid, targets.lowMid, dt),
    mid: smoothBand(prev.bands.mid, targets.mid, dt),
    vocal: smoothBand(prev.bands.vocal, targets.vocal, dt),
    treble: smoothBand(prev.bands.treble, targets.treble, dt),
  };
  const power = smoothBand(prev.power, powerTarget, dt);

  return { power, bands, active: true, updatedAt: now };
};
