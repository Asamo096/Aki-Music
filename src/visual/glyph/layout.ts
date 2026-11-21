// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 「逐字歌词」排版（V2.1）。
 *
 * 观感目标（用户描述 + Folia 参考截图）：
 *   - 同一句的字符逐个出现，**已经出现的字符保留**
 *   - 新字符从随机偏移/角度/缩放"扔"到最终位置（ease-out-back）
 *   - 最终位置带一点手摆的抖动（高度/角度），最新一个字高亮发光
 *
 * 纯函数：字体测量由调用方注入；随机种子由行/字确定性生成，重播一致。
 */
import type { LyricLine } from '@/lyrics/types';
import { getLineSecondaryText } from '@/lyrics/utils/text';
import { buildGlyphTimings } from '@/visual/fume/layout';

export type GlyphSecondary = 'translation' | 'romaPronunciation' | 'none';

/** 最终排列方式：plain = 旧刚性直线（仅主歌词页内部使用）；line = 上下交错 + 随机倾斜 */
export type GlyphRowLayoutMode = 'plain' | 'line';

/** 单字最大倾斜角：18°（再大就不美观了） */
export const GLYPH_MAX_TILT = Math.PI / 10;

export interface GlyphCell {
  char: string;
  startTime: number;
  isSpace: boolean;
  /** 最终位置（相对行首，CSS 像素） */
  x: number;
  /** 最终字号下的单字宽度 */
  width: number;
  y: number;
  rotation: number;
  /** 入场起点（相对最终位置的偏移） */
  fromX: number;
  fromY: number;
  fromRotation: number;
  fromScale: number;
  /** 0..1 确定性随机（决定入场时长/抖动） */
  seed: number;
}

export interface GlyphRowLayout {
  index: number;
  text: string;
  translation: string | null;
  fontSize: number;
  spacing: number;
  width: number;
  cells: GlyphCell[];
}

export interface GlyphLayoutOptions {
  maxWidth: number;
  baseFontSize: number;
  minFontSize: number;
  secondary?: GlyphSecondary;
  /** 最终排列方式（默认 line） */
  layout?: GlyphRowLayoutMode;
  /** measure(text, fontSize) → 宽度 */
  measure: (text: string, fontSize: number) => number;
}

export interface GlyphPose {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  alpha: number;
  /** 0..1，1 表示已落位 */
  settled: number;
}

/** 确定性哈希 → 0..1 */
export const hashSeed = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
};

/** ease-out-back：有轻微过冲，像"扔过去"后回弹一下 */
export const easeOutBack = (progress: number): number => {
  const p = Math.min(1, Math.max(0, progress));
  const c1 = 1.15;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** 自动缩放：保证整行（含字距）放进 maxWidth */
export const fitGlyphFontSize = (
  text: string,
  options: Pick<
    GlyphLayoutOptions,
    'baseFontSize' | 'minFontSize' | 'maxWidth' | 'measure'
  > & { layout?: GlyphRowLayoutMode }
): number => {
  const chars = Array.from(text);
  // “直线”（上下交错）需要更大的平均字距，估算时按 0.72 倍字号留出余量
  const spacingRatio = options.layout === 'line' ? 0.72 : 0.16;
  const estimate = (size: number): number => {
    let width = 0;
    for (const char of chars) width += options.measure(char, size);
    const spacing = Math.max(2, size * spacingRatio);
    return width + spacing * Math.max(0, chars.length - 1);
  };
  let size = Math.max(options.minFontSize, options.baseFontSize);
  while (size > options.minFontSize && estimate(size) > options.maxWidth) {
    size -= 2;
  }
  return size;
};

/** 当前行的逐字排版 */
export const buildGlyphRow = (
  line: LyricLine,
  index: number,
  options: GlyphLayoutOptions
): GlyphRowLayout => {
  const text = (line.words || []).map(word => word.text).join('');
  const chars = Array.from(text);
  const secondary = options.secondary ?? 'translation';
  const translation =
    secondary === 'none' ? null : getLineSecondaryText(line, secondary) || null;

  const layoutMode: GlyphRowLayoutMode = options.layout ?? 'line';
  const fontSize = fitGlyphFontSize(text, {
    ...options,
    layout: layoutMode,
  });
  const glyphTimings = buildGlyphTimings(line, chars);
  const freeform = layoutMode === 'line';

  const charWidths = chars.map(char => options.measure(char, fontSize));
  const sumWidth = charWidths.reduce((sum, width) => sum + width, 0);
  const minSpacing = Math.max(3, fontSize * 0.16);
  const targetWidth = options.maxWidth * 0.92;
  let spacing = minSpacing;
  if (!freeform && chars.length > 1 && chars.length <= 10) {
    // 短句铺开：字符之间留出明显间隙（参考截图里的大字距）
    const spreadCap = chars.length <= 6 ? fontSize * 2.2 : fontSize * 1.4;
    spacing = clamp(
      (targetWidth - sumWidth) / (chars.length - 1),
      minSpacing,
      spreadCap
    );
  }

  const seedKey = `${line.startTime ?? 0}:${index}:${text}`;
  const cells: GlyphCell[] = [];
  const freeformBaseGap = fontSize * 0.44;
  const freeformMinGap = fontSize * 0.26;
  const freeformMaxGap = fontSize * 1.15;
  // 一句话的起伏方向：偶数位/奇数位交错，整体随机从哪一边开始
  const waveSign = hashSeed(`${seedKey}:wave`) > 0.5 ? 1 : -1;
  // 倾斜：左右均衡（奇偶交错），最大 ±18°，且多数角度更接近 0
  const tiltWave = hashSeed(`${seedKey}:tiltWave`) > 0.5 ? 1 : -1;
  let cursor = 0;
  chars.forEach((char, charIndex) => {
    const time = glyphTimings[charIndex]?.startTime ?? 0;
    const seed = hashSeed(`${seedKey}:${charIndex}:${char}`);
    const jitterSeed = hashSeed(`${seedKey}:jitter:${charIndex}`);
    const gapSeed = hashSeed(`${seedKey}:gap:${charIndex}`);
    const tiltSeed = hashSeed(`${seedKey}:tilt:${charIndex}`);
    const riseSeed = hashSeed(`${seedKey}:rise:${charIndex}`);
    const fromSeed = hashSeed(`${seedKey}:from:${charIndex}`);
    const fromYSeed = hashSeed(`${seedKey}:fromY:${charIndex}`);
    const x =
      freeform && charIndex > 0
        ? cursor +
          clamp(
            freeformBaseGap + (gapSeed - 0.5) * fontSize * 0.6,
            freeformMinGap,
            freeformMaxGap
          )
        : cursor;
    // 直线（上下交错）：奇偶交错地浮上去/沉下去，幅度 0.3–0.85 字号
    const riseDirection = waveSign * (charIndex % 2 === 0 ? 1 : -1);
    const riseAmount = fontSize * (0.3 + Math.abs(riseSeed * 2 - 1) * 0.55);
    // 倾斜：左右交替，幅度偏向小角度（0–18°）
    const tiltDirection = tiltWave * (charIndex % 2 === 0 ? 1 : -1);
    const tiltMagnitude =
      GLYPH_MAX_TILT * (0.12 + 0.88 * Math.pow(tiltSeed, 2));
    cells.push({
      char,
      startTime: time,
      isSpace: char === ' ',
      x,
      width: charWidths[charIndex],
      y: freeform
        ? riseDirection * riseAmount
        : (jitterSeed - 0.5) * fontSize * 0.14,
      rotation: freeform
        ? tiltDirection * tiltMagnitude
        : (jitterSeed * 2 - 1) * 0.035,
      fromX: (fromSeed * 2 - 1) * Math.min(320, options.maxWidth * 0.24),
      fromY:
        (fromYSeed > 0.5 ? 1 : -1) * (80 + Math.abs(fromYSeed * 2 - 1) * 170),
      fromRotation: (fromSeed * 2 - 1) * 1.1,
      fromScale: 0.45 + fromYSeed * 0.4,
      seed,
    });
    cursor = x + charWidths[charIndex];
    if (!freeform) cursor += spacing;
  });

  return {
    index,
    text,
    translation,
    fontSize,
    spacing: freeform ? freeformBaseGap : spacing,
    width: Math.max(0, cursor),
    cells,
  };
};

/**
 * 某个字符在当前时刻的姿态。
 * 未到出现时间返回 null；落位后保持一致。
 */
export const resolveGlyphPose = (
  cell: GlyphCell,
  now: number
): GlyphPose | null => {
  const duration = 0.4 + cell.seed * 0.18;
  const dt = now - cell.startTime;
  if (dt <= 0) return null;
  const progress = clamp(dt / duration, 0, 1);
  const eased = easeOutBack(progress);
  return {
    x: cell.x + cell.fromX * (1 - eased),
    y: cell.y + cell.fromY * (1 - eased),
    rotation: cell.rotation + cell.fromRotation * (1 - eased),
    scale: cell.fromScale + (1 - cell.fromScale) * eased,
    alpha: clamp(progress * 3, 0, 1),
    settled: progress,
  };
};

/** 当前句里最新出现的字符（用于高亮发光） */
export const resolveLatestCell = (
  row: GlyphRowLayout,
  now: number
): GlyphCell | null => {
  let latest: GlyphCell | null = null;
  for (const cell of row.cells) {
    if (cell.startTime <= now && !cell.isSpace) {
      if (!latest || cell.startTime >= latest.startTime) latest = cell;
    }
  }
  return latest;
};
