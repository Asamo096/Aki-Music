// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 封面 → 歌词主题（离线取色，决策 D9）。
 *
 * 这里回答两个问题：
 *   1. 「多颜色」从哪来 —— 封面取色得到一组代表色，映射成背景 / 主色 / 副色 / 点缀色
 *   2. 「根据歌曲情感、风格自主变幻」怎么落地 —— **不引入任何模型**：
 *      从调色板本身的饱和度与明度分布推断一个情绪档位（calm / balanced / energetic），
 *      再由档位决定模糊色块的运动速度与强度。封面是歌的"情绪名片"，
 *      静图取色已经把"这首歌是什么调性"带进来了；同一首歌每次结果一致（可复现）。
 *
 * 本文件只做**纯计算**（调色板 → 主题），不引入任何取色/图片依赖，
 * 因此可以在 node 环境的单测里直接验证；真正的取色见 coverThemeExtract.ts。
 *
 * 与 folia 的关系：色板提取思路与 FluidBackground 的用色方式来自 folia
 * （AGPL-3.0），对比度求解由 themeColorMath（同源移植）提供；
 * 「情绪档位」这一层是本项目为"无音频图"场景补的。
 */
import {
  adjustLightnessForContrast,
  getContrastRatio,
  getRelativeLuminance,
  hexToHsl,
  mixHexColors,
} from './themeColorMath';

export type CoverMood = 'calm' | 'balanced' | 'energetic';

export interface CoverTheme {
  /** 背景底色（深色，保证歌词可读） */
  backgroundColor: string;
  /** 主色：逐字扫过的亮色 */
  primaryColor: string;
  /** 副色 / 点缀色：模糊色块用 */
  secondaryColor: string;
  accentColor: string;
  /** 情绪档位（由调色板推断） */
  mood: CoverMood;
  /** 色块呼吸/漂移一个周期的秒数（越"激烈"越短） */
  motionDuration: number;
  /** 色块强度 0..1 */
  blobStrength: number;
  /** 参与渲染的调色板（hex，按鲜艳度排序） */
  palette: string[];
  /** 调色板平均相对亮度 0..1（决定背景压暗力度） */
  backgroundLuminance: number;
  /** 覆盖在模糊封面上的暗色遮罩不透明度（浅封面更高，保证白字可读） */
  veilOpacity: number;
}

/** 歌词正文与背景的最低对比度（WCAG AA 正文标准） */
const MIN_TEXT_CONTRAST = 4.5;
/** 背景亮度过高时，歌词会看不清；用这个上限把它压下去 */
const MAX_BACKGROUND_LUMINANCE = 0.16;
/** 没取到色时的兜底主题（深蓝紫，与歌词页现有暗色观感一致） */
export const FALLBACK_COVER_THEME: CoverTheme = {
  backgroundColor: '#15161c',
  primaryColor: '#eaeffd',
  secondaryColor: '#5b6cff',
  accentColor: '#ff7ac6',
  mood: 'balanced',
  motionDuration: 26,
  blobStrength: 0.5,
  palette: [],
  backgroundLuminance: 0.2,
  veilOpacity: 0.3,
};

/** 情绪档位判定：看调色板的平均饱和度和平均明度 */
const inferMood = (palette: string[]): CoverMood => {
  const hsl = palette
    .map(hexToHsl)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (hsl.length === 0) return 'balanced';

  const avgSaturation =
    hsl.reduce((sum, color) => sum + color.s, 0) / hsl.length;
  const avgLightness =
    hsl.reduce((sum, color) => sum + color.l, 0) / hsl.length;

  // 又艳又亮 → 激烈；又灰又暗 → 安静；其余居中
  if (avgSaturation >= 0.55 && avgLightness >= 0.4) return 'energetic';
  if (avgSaturation >= 0.45 || avgLightness >= 0.3) return 'balanced';
  return 'calm';
};

const MOOD_MOTION: Record<CoverMood, { duration: number; strength: number }> = {
  calm: { duration: 36, strength: 0.34 },
  balanced: { duration: 26, strength: 0.5 },
  energetic: { duration: 15, strength: 0.72 },
};

/**
 * 调色板 → 主题。**纯函数**，便于单测与缓存。
 *
 * @param palette 任意数量（≥1）的 hex 颜色；少于 4 个时会自动派生补足
 */
export const buildCoverTheme = (palette: string[]): CoverTheme => {
  const cleaned = palette
    .filter(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    .slice(0, 8);

  if (cleaned.length === 0) {
    return { ...FALLBACK_COVER_THEME };
  }

  // 按鲜艳度（饱和度 × 明度，暗的权重低一点）排序，最"跳"的颜色先上
  const vibrancyScore = (color: string): number => {
    const hsl = hexToHsl(color);
    return hsl ? hsl.s * (0.4 + hsl.l * 0.6) : 0;
  };
  const ranked = [...cleaned].sort(
    (a, b) => vibrancyScore(b) - vibrancyScore(a)
  );

  const mood = inferMood(cleaned);
  const { duration, strength } = MOOD_MOTION[mood];

  // 背景：取最暗的代表色，再把它压到亮度上限以下
  const darkest = [...cleaned].sort(
    (a, b) => getRelativeLuminance(a) - getRelativeLuminance(b)
  )[0];
  let backgroundColor = mixHexColors(darkest, '#0b0c10', 0.45);
  for (let step = 0; step < 20; step += 1) {
    if (getRelativeLuminance(backgroundColor) <= MAX_BACKGROUND_LUMINANCE)
      break;
    backgroundColor = mixHexColors(backgroundColor, '#000000', 0.12);
  }

  // 主色：最鲜艳的颜色，但要保证在背景上读得清
  const primaryColor = adjustLightnessForContrast(
    ranked[0],
    backgroundColor,
    MIN_TEXT_CONTRAST
  );

  // 副色 / 点缀：优先取与主色色相不同的颜色，让模糊色块真的"多颜色"
  const primaryHue = hexToHsl(primaryColor)?.h ?? 0;
  const hueDistance = (color: string) => {
    const hue = hexToHsl(color)?.h;
    if (hue === undefined) return 0;
    const raw = Math.abs(hue - primaryHue);
    return Math.min(raw, 360 - raw);
  };
  const others = ranked
    .slice(1)
    .sort((a, b) => hueDistance(b) - hueDistance(a));
  const secondaryCandidate =
    others[0] ?? mixHexColors(ranked[0], '#ffffff', 0.2);
  const accentCandidate = others[1] ?? mixHexColors(ranked[0], '#000000', 0.25);

  const secondaryColor = blobsContrast(secondaryCandidate, backgroundColor);
  const accentColor = blobsContrast(accentCandidate, backgroundColor);

  // 模糊封面层是原图亮度，不是 backgroundColor：浅封面会盖住暗色主题，
  // 用调色板平均亮度决定一层压暗遮罩，让实际背景接近“保证对比度”的底色。
  const backgroundLuminance =
    cleaned.reduce((sum, color) => sum + getRelativeLuminance(color), 0) /
    cleaned.length;
  const VEIL_TARGET_LUMINANCE = 0.16;
  const veilOpacity = Math.min(
    0.72,
    Math.max(
      0.18,
      (backgroundLuminance - VEIL_TARGET_LUMINANCE) /
        Math.max(0.12, backgroundLuminance - 0.02)
    )
  );

  return {
    backgroundColor,
    primaryColor,
    secondaryColor,
    accentColor,
    mood,
    motionDuration: duration,
    blobStrength: strength,
    palette: ranked,
    backgroundLuminance,
    veilOpacity,
  };
};

/**
 * 色块用的颜色不需要"正文级"对比度（它们是背景的一部分，太亮会抢歌词），
 * 但也不能和背景糊成一片 —— 这里保证与背景至少有 1.35 的可见差异。
 */
const blobsContrast = (color: string, background: string): string =>
  getContrastRatio(color, background) >= 1.35
    ? color
    : adjustLightnessForContrast(color, background, 1.6);
