// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  adjustLightnessForContrast,
  clamp01,
  getContrastRatio,
  getRelativeLuminance,
  hexToHsl,
  hslToHex,
  mixHexColors,
  normalizeHue,
  parseThemeColor,
  rgbToHex,
  rgbToHsl,
} from '@/visual/themeColorMath';
import { buildCoverTheme, FALLBACK_COVER_THEME } from '@/visual/coverTheme';
import {
  getLyricBackgroundMeta,
  isDarkBackgroundStyle,
  LYRIC_BACKGROUND_STYLES,
  normalizeLyricBackgroundStyle,
} from '@/settings/lyricBackground';

/* ───────────────── 颜色数学（移植自 folia）───────────────── */

describe('parseThemeColor', () => {
  it('支持 #rgb / #rrggbb / rgb() / rgba()', () => {
    expect(parseThemeColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseThemeColor('#1a2b3c')).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseThemeColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseThemeColor('rgba(10,20,30,0.5)')).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });

  it('非法输入返回 null 而不是抛错', () => {
    expect(parseThemeColor('not-a-color')).toBe(null);
    expect(parseThemeColor('#12')).toBe(null);
    expect(parseThemeColor('')).toBe(null);
    expect(parseThemeColor(undefined)).toBe(null);
  });
});

describe('HSL 往返', () => {
  it('转换可逆（误差 ≤ 1/255）', () => {
    for (const hex of ['#1a2b3c', '#ff0000', '#00ff88', '#7f7f7f', '#ffffff']) {
      const back = hslToHex(hexToHsl(hex));
      expect(back).toBe(hex);
    }
  });

  it('灰色饱和度为 0', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });

  it('normalizeHue / clamp01 边界', () => {
    expect(normalizeHue(-90)).toBe(270);
    expect(normalizeHue(450)).toBe(90);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});

describe('mixHexColors', () => {
  it('两端与中点', () => {
    expect(mixHexColors('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHexColors('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHexColors('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('非法颜色不抛错（退回可解析的一方）', () => {
    expect(mixHexColors('bogus', '#ffffff', 0.5)).toBe('#ffffff');
  });
});

describe('对比度与亮度求解', () => {
  it('黑白对比度为 21，自身为 1', () => {
    expect(getContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(getContrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('亮度边界', () => {
    expect(getRelativeLuminance('#000000')).toBe(0);
    expect(getRelativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('在深色背景上把过暗的颜色提亮到可读', () => {
    const background = '#101014';
    const source = '#141428';
    expect(getContrastRatio(source, background)).toBeLessThan(4.5);
    const fixed = adjustLightnessForContrast(source, background, 4.5);
    expect(getContrastRatio(fixed, background)).toBeGreaterThanOrEqual(4.5);
    // 色相保持（提亮不应该变成另一个色系）
    const before = hexToHsl(source).h;
    const after = hexToHsl(fixed).h;
    expect(Math.abs(before - after)).toBeLessThan(1);
  });

  it('在浅色背景上把过亮的颜色压暗', () => {
    const background = '#f2f2f2';
    const source = '#fbfbfb';
    const fixed = adjustLightnessForContrast(source, background, 4.5);
    expect(getContrastRatio(fixed, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('无法解析的颜色原样返回', () => {
    expect(adjustLightnessForContrast('bogus', '#000', 4.5)).toBe('bogus');
  });
});

/* ───────────────── 封面主题生成 ───────────────── */

describe('buildCoverTheme', () => {
  it('空调色板 → 兜底主题', () => {
    expect(buildCoverTheme([])).toEqual(FALLBACK_COVER_THEME);
    expect(buildCoverTheme(['bogus'])).toEqual(FALLBACK_COVER_THEME);
  });

  it('背景够暗、主色与背景对比度达标（歌词可读）', () => {
    const theme = buildCoverTheme([
      '#f4c542',
      '#8b1e3f',
      '#2d6a4f',
      '#bc6c25',
      '#1d3557',
    ]);
    expect(getRelativeLuminance(theme.backgroundColor)).toBeLessThanOrEqual(
      0.16
    );
    expect(
      getContrastRatio(theme.primaryColor, theme.backgroundColor)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('副色/点缀色与背景有可见差异（色块不会糊成一片）', () => {
    const theme = buildCoverTheme(['#e0e0e0', '#d5d5d5', '#cccccc', '#c0c0c0']);
    expect(
      getContrastRatio(theme.secondaryColor, theme.backgroundColor)
    ).toBeGreaterThanOrEqual(1.35);
    expect(
      getContrastRatio(theme.accentColor, theme.backgroundColor)
    ).toBeGreaterThanOrEqual(1.35);
  });

  it('情绪档位随调色板的饱和/明度变化', () => {
    const energetic = buildCoverTheme([
      '#ff2d55',
      '#ffcc00',
      '#00e5ff',
      '#ff6b00',
    ]);
    const calm = buildCoverTheme(['#3a3a3a', '#4a4646', '#413f3f', '#545050']);
    expect(energetic.mood).toBe('energetic');
    expect(calm.mood).toBe('calm');
    // 越"激烈"动得越快、色块越强
    expect(energetic.motionDuration).toBeLessThan(calm.motionDuration);
    expect(energetic.blobStrength).toBeGreaterThan(calm.blobStrength);
  });

  it('同一调色板结果稳定（可缓存、可复现）', () => {
    const palette = ['#123456', '#654321', '#abcdef'];
    expect(buildCoverTheme(palette)).toEqual(buildCoverTheme(palette));
  });

  it('调色板按鲜艳度排序，最跳的颜色进主色位', () => {
    const theme = buildCoverTheme(['#808080', '#ff0000', '#404040']);
    expect(theme.palette[0].toLowerCase()).toBe('#ff0000');
  });
});

/* ───────────────── 背景风格注册表（设置迁移）───────────────── */

describe('lyricBackground 注册表', () => {
  it('保留原有四种 + 新增多色模糊', () => {
    expect(LYRIC_BACKGROUND_STYLES.map(s => s.value)).toEqual([
      true,
      'blur',
      'dynamic',
      'fluid',
      false,
    ]);
  });

  it('旧值语义不变（设置迁移不需要改数据）', () => {
    expect(normalizeLyricBackgroundStyle(true)).toBe(true);
    expect(normalizeLyricBackgroundStyle(false)).toBe(false);
    expect(normalizeLyricBackgroundStyle('blur')).toBe('blur');
    expect(normalizeLyricBackgroundStyle('dynamic')).toBe('dynamic');
  });

  it('未知值按原有默认值 true 处理', () => {
    expect(normalizeLyricBackgroundStyle('xxx')).toBe(true);
    expect(normalizeLyricBackgroundStyle(undefined)).toBe(true);
    expect(normalizeLyricBackgroundStyle(null)).toBe(true);
  });

  it('深色主题判定：取色渐变与多色模糊为深色', () => {
    expect(isDarkBackgroundStyle(true)).toBe(true);
    expect(isDarkBackgroundStyle('fluid')).toBe(true);
    expect(isDarkBackgroundStyle('blur')).toBe(false);
    expect(isDarkBackgroundStyle('dynamic')).toBe(false);
    expect(isDarkBackgroundStyle(false)).toBe(false);
  });

  it('每个风格都有展示键与成本标注', () => {
    for (const style of LYRIC_BACKGROUND_STYLES) {
      const meta = getLyricBackgroundMeta(style.value);
      expect(meta.labelKey).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(meta.cost);
    }
  });
});
