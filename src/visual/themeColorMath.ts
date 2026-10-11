// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 folia-major（AGPL-3.0，https://github.com/chthollyphile/folia-major）
//   src/utils/themeColorMath.ts
// Modified for Aki Music on 2026-10-11:
//   1. 颜色解析改为本文件内实现（folia 依赖它的 colorMix 模块，本项目不需要那一层）
//   2. 只保留主题生成需要的部分（转换 / 混合 / 对比度 / 亮度求解），去掉亮度轴搜索里
//      folia 特有的调参入口
//
// 作用：把封面取到的颜色变成一套**能读得清**的歌词配色。核心是最后那个
// adjustLightnessForContrast —— 在保持色相的前提下沿明度轴走，直到与背景达到
// 最低对比度，而不是简单换个预置色（那会让不同封面看起来都一样）。

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const FALLBACK_COLOR = '#4f7cff';

export const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

export const normalizeHue = (hue: number): number => ((hue % 360) + 360) % 360;

/** 支持 #rgb / #rrggbb / rgb() / rgba()；其它形式返回 null */
export const parseThemeColor = (value: string): Rgb | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (hex.length === 3) {
      const [r, g, b] = [...hex].map(char => parseInt(char + char, 16));
      return Number.isNaN(r) ? null : { r, g, b };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)
        ? null
        : { r, g, b };
    }
    return null;
  }

  const match = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!match) return null;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts
    .slice(0, 3)
    .map(part =>
      part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part)
    );
  if (channels.some(Number.isNaN)) return null;

  return { r: channels[0], g: channels[1], b: channels[2] };
};

export const rgbToHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b]
    .map(channel => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

export const rgbToHsl = ({ r, g, b }: Rgb): Hsl => {
  const red = clampChannel(r) / 255;
  const green = clampChannel(g) / 255;
  const blue = clampChannel(b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));

  let hue: number;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return {
    h: normalizeHue(hue * 60),
    s: clamp01(saturation),
    l: clamp01(lightness),
  };
};

export const hslToRgb = ({ h, s, l }: Hsl): Rgb => {
  const hue = normalizeHue(h);
  const saturation = clamp01(s);
  const lightness = clamp01(l);

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;

  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] =
    sector === 0
      ? [chroma, secondary, 0]
      : sector === 1
      ? [secondary, chroma, 0]
      : sector === 2
      ? [0, chroma, secondary]
      : sector === 3
      ? [0, secondary, chroma]
      : sector === 4
      ? [secondary, 0, chroma]
      : [chroma, 0, secondary];

  return {
    r: clampChannel((r + offset) * 255),
    g: clampChannel((g + offset) * 255),
    b: clampChannel((b + offset) * 255),
  };
};

export const hexToHsl = (color: string): Hsl | null => {
  const parsed = parseThemeColor(color);
  return parsed ? rgbToHsl(parsed) : null;
};

export const hslToHex = (hsl: Hsl): string => rgbToHex(hslToRgb(hsl));

/** 线性混合（在 RGB 空间），结果一定是 hex */
export const mixHexColors = (
  from: string,
  to: string,
  amount: number
): string => {
  const start = parseThemeColor(from);
  const end = parseThemeColor(to);
  const fallback = parseThemeColor(FALLBACK_COLOR)!;

  if (!start || !end) {
    return rgbToHex(parseThemeColor(to) ?? parseThemeColor(from) ?? fallback);
  }

  const ratio = clamp01(amount);
  return rgbToHex({
    r: start.r + (end.r - start.r) * ratio,
    g: start.g + (end.g - start.g) * ratio,
    b: start.b + (end.b - start.b) * ratio,
  });
};

/** WCAG 相对亮度（0 黑 1 白） */
export const getRelativeLuminance = (color: string): number => {
  const parsed = parseThemeColor(color);
  if (!parsed) return 0;

  const transform = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * transform(parsed.r) +
    0.7152 * transform(parsed.g) +
    0.0722 * transform(parsed.b)
  );
};

export const getContrastRatio = (
  foreground: string,
  background: string
): number => {
  const a = getRelativeLuminance(foreground);
  const b = getRelativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * 沿明度轴把颜色推向"能看清"的一侧，保持色相与饱和度不变。
 * 到不了目标对比度时返回过程中对比度最高的那个候选。
 */
export const adjustLightnessForContrast = (
  color: string,
  background: string,
  minRatio: number,
  step = 0.02,
  maxSteps = 50
): string => {
  const hsl = hexToHsl(color);
  if (!hsl) return color;

  const goDarker = getRelativeLuminance(background) > 0.35;
  const direction = goDarker ? -1 : 1;

  let bestColor = hslToHex(hsl);
  let bestRatio = getContrastRatio(bestColor, background);

  for (let index = 0; index <= maxSteps; index += 1) {
    const lightness = clamp01(hsl.l + direction * step * index);
    const candidate = hslToHex({ ...hsl, l: lightness });
    const ratio = getContrastRatio(candidate, background);

    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestColor = candidate;
    }
    if (ratio >= minRatio) {
      return candidate;
    }
    // 已经贴到明度轴端点，再走也不会更好
    if (index > 0 && (lightness === 0 || lightness === 1)) {
      break;
    }
  }

  return bestColor;
};
