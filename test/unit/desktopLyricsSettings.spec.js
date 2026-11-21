import { describe, expect, it } from 'vitest';
import {
  DESKTOP_LYRICS_DEFAULTS,
  normalizeDesktopLyricsSettings,
} from '../../src/shared/lyricsSnapshot';

describe('desktop lyrics settings', () => {
  it('默认样式为经典', () => {
    expect(DESKTOP_LYRICS_DEFAULTS.visualStyle).toBe('classic');
    expect(normalizeDesktopLyricsSettings({}).visualStyle).toBe('classic');
  });

  it('合法样式保留，非法值回落经典', () => {
    expect(
      normalizeDesktopLyricsSettings({ visualStyle: 'sentence' }).visualStyle
    ).toBe('sentence');
    expect(
      normalizeDesktopLyricsSettings({ visualStyle: 'glyph' }).visualStyle
    ).toBe('glyph');
    expect(
      normalizeDesktopLyricsSettings({ visualStyle: 'bogus' }).visualStyle
    ).toBe('classic');
  });

  it('逐字排列默认直线，合法值保留、非法值回落', () => {
    expect(normalizeDesktopLyricsSettings({}).glyphLayout).toBe('line');
    expect(
      normalizeDesktopLyricsSettings({ glyphLayout: 'scatter' }).glyphLayout
    ).toBe('line');
    expect(
      normalizeDesktopLyricsSettings({ glyphLayout: 'bogus' }).glyphLayout
    ).toBe('line');
  });

  it('文字效果默认阴影，合法值保留、非法值回落', () => {
    expect(normalizeDesktopLyricsSettings({}).textEffect).toBe('shadow');
    expect(
      normalizeDesktopLyricsSettings({ textEffect: 'outline' }).textEffect
    ).toBe('outline');
    expect(
      normalizeDesktopLyricsSettings({ textEffect: 'glow' }).textEffect
    ).toBe('glow');
    expect(
      normalizeDesktopLyricsSettings({ textEffect: 'bogus' }).textEffect
    ).toBe('shadow');
  });

  it('调参默认值独立于主页面，脏值归一化', () => {
    const defaults = normalizeDesktopLyricsSettings({}).tuning;
    expect(defaults.entryDurationScale).toBe(0.5);
    const tuning = normalizeDesktopLyricsSettings({
      tuning: { tiltMaxDeg: 12, spacingRatio: 100 },
    }).tuning;
    expect(tuning.tiltMaxDeg).toBe(12);
    expect(tuning.spacingRatio).toBe(0.9);
    expect(tuning.entryDurationScale).toBe(0.5);
  });

  it('样式不影响位置/字体/字号/颜色的归一化', () => {
    const settings = normalizeDesktopLyricsSettings({
      visualStyle: 'glyph',
      position: 'top',
      fontSize: 40,
      color: '#ff0000',
    });
    expect(settings.position).toBe('top');
    expect(settings.fontSize).toBe(40);
    expect(settings.color).toBe('#ff0000');
    expect(settings.visualStyle).toBe('glyph');
  });
});
