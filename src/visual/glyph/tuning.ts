// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 逐字歌词的调参模型（V3）。
 *
 * 主歌词页与桌面歌词各持一份；渲染器只消费归一化后的值。
 * 默认值保持 2026-11-21 的观感（倾斜 18°、幅度 0.85、间距 0.44、入场 1×、发光 1×）。
 */

export interface GlyphTuning {
  /** 单字最大倾斜角（度） */
  tiltMaxDeg: number;
  /** 上下浮动幅度倍率（1 = 当前 0.3–0.85 字号） */
  riseScale: number;
  /** 词/字横向间距（字号倍率） */
  spacingRatio: number;
  /** 入场动画时长缩放（越小越快） */
  entryDurationScale: number;
  /** 发光强度倍率 */
  glowScale: number;
}

export const DEFAULT_GLYPH_TUNING: GlyphTuning = {
  tiltMaxDeg: 18,
  riseScale: 0.85,
  spacingRatio: 0.44,
  entryDurationScale: 1,
  glowScale: 1,
};

export const DESKTOP_GLYPH_TUNING_DEFAULTS: GlyphTuning = {
  ...DEFAULT_GLYPH_TUNING,
  // 桌面歌词要跟得上唱词，入场默认更快
  entryDurationScale: 0.5,
};

export const GLYPH_TUNING_RANGES = {
  tiltMaxDeg: { min: 0, max: 30, step: 1 },
  riseScale: { min: 0, max: 1.2, step: 0.05 },
  spacingRatio: { min: 0.2, max: 0.9, step: 0.02 },
  entryDurationScale: { min: 0.4, max: 1.5, step: 0.05 },
  glowScale: { min: 0, max: 1.5, step: 0.05 },
} as const;

export type GlyphTuningKey = keyof GlyphTuning;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const pick = (
  source: Partial<Record<GlyphTuningKey, unknown>> | null | undefined,
  key: GlyphTuningKey,
  fallback: number
): number => {
  const raw = source?.[key];
  // Number(null) === 0，脏值不能悄悄变成合法的 0
  if (
    raw === null ||
    raw === undefined ||
    raw === '' ||
    typeof raw === 'boolean'
  ) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const range = GLYPH_TUNING_RANGES[key];
  return clamp(value, range.min, range.max);
};

/** 归一化（脏值/缺字段回落到 fallback，桌面用 entry=0.5 的 fallback） */
export const normalizeGlyphTuning = (
  value: unknown,
  fallback: GlyphTuning = DEFAULT_GLYPH_TUNING
): GlyphTuning => {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<Record<GlyphTuningKey, unknown>>)
      : null;
  return {
    tiltMaxDeg: pick(source, 'tiltMaxDeg', fallback.tiltMaxDeg),
    riseScale: pick(source, 'riseScale', fallback.riseScale),
    spacingRatio: pick(source, 'spacingRatio', fallback.spacingRatio),
    entryDurationScale: pick(
      source,
      'entryDurationScale',
      fallback.entryDurationScale
    ),
    glowScale: pick(source, 'glowScale', fallback.glowScale),
  };
};
