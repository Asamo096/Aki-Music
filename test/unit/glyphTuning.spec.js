import { describe, expect, it } from 'vitest';
import { buildGlyphRow } from '../../src/visual/glyph/layout';
import {
  DEFAULT_GLYPH_TUNING,
  DESKTOP_GLYPH_TUNING_DEFAULTS,
  GLYPH_TUNING_RANGES,
  normalizeGlyphTuning,
} from '../../src/visual/glyph/tuning';

describe('glyph tuning', () => {
  it('缺省值保持当前观感', () => {
    expect(normalizeGlyphTuning(undefined)).toEqual(DEFAULT_GLYPH_TUNING);
    expect(normalizeGlyphTuning({})).toEqual(DEFAULT_GLYPH_TUNING);
  });

  it('越界值夹到范围内', () => {
    const tuning = normalizeGlyphTuning({
      tiltMaxDeg: 90,
      riseScale: -1,
      spacingRatio: 5,
      entryDurationScale: -3,
      glowScale: 99,
    });
    expect(tuning.tiltMaxDeg).toBe(GLYPH_TUNING_RANGES.tiltMaxDeg.max);
    expect(tuning.riseScale).toBe(GLYPH_TUNING_RANGES.riseScale.min);
    expect(tuning.spacingRatio).toBe(GLYPH_TUNING_RANGES.spacingRatio.max);
    expect(tuning.entryDurationScale).toBe(
      GLYPH_TUNING_RANGES.entryDurationScale.min
    );
    expect(tuning.glowScale).toBe(GLYPH_TUNING_RANGES.glowScale.max);
  });

  it('脏值回落到 fallback', () => {
    const tuning = normalizeGlyphTuning({
      tiltMaxDeg: 'wide',
      riseScale: null,
      spacingRatio: NaN,
    });
    expect(tuning).toEqual(DEFAULT_GLYPH_TUNING);
  });

  it('调参真的改变逐字布局', () => {
    const line = {
      words: [{ text: '有时在空气中', startTime: 0, endTime: 3 }],
      startTime: 0,
      endTime: 3,
    };
    const base = {
      maxWidth: 1200,
      baseFontSize: 80,
      minFontSize: 30,
      measure: (text, size) => text.length * size,
    };
    const flat = buildGlyphRow(line, 0, {
      ...base,
      tuning: { ...DEFAULT_GLYPH_TUNING, tiltMaxDeg: 0 },
    });
    expect(flat.cells.every(cell => cell.rotation === 0)).toBe(true);

    const tilted = buildGlyphRow(line, 0, {
      ...base,
      tuning: { ...DEFAULT_GLYPH_TUNING, tiltMaxDeg: 30 },
    });
    const maxTilt = Math.max(
      ...tilted.cells.map(cell => Math.abs(cell.rotation))
    );
    expect(maxTilt).toBeGreaterThan((8 * Math.PI) / 180);
    expect(maxTilt).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-6);

    const narrow = buildGlyphRow(line, 0, {
      ...base,
      tuning: { ...DEFAULT_GLYPH_TUNING, spacingRatio: 0.2 },
    });
    const wide = buildGlyphRow(line, 0, {
      ...base,
      tuning: { ...DEFAULT_GLYPH_TUNING, spacingRatio: 0.9 },
    });
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('桌面默认入场更快，缺失 entry 时用桌面 fallback', () => {
    expect(DESKTOP_GLYPH_TUNING_DEFAULTS.entryDurationScale).toBe(0.5);
    const tuning = normalizeGlyphTuning(
      { tiltMaxDeg: 24 },
      DESKTOP_GLYPH_TUNING_DEFAULTS
    );
    expect(tuning.tiltMaxDeg).toBe(24);
    expect(tuning.entryDurationScale).toBe(0.5);
    expect(tuning.spacingRatio).toBe(
      DESKTOP_GLYPH_TUNING_DEFAULTS.spacingRatio
    );
  });
});
