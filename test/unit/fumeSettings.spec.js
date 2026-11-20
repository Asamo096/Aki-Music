import { describe, expect, it } from 'vitest';
import {
  migrateVisualSettings,
  normalizeFumeStyle,
} from '../../src/settings/fume';

describe('fume settings migration', () => {
  it('旧的 glyph 模式迁移为 Fume + 逐字样式', () => {
    expect(migrateVisualSettings({ visualMode: 'glyph' })).toEqual({
      visualMode: 'fume',
      fumeStyle: 'glyph',
    });
  });

  it('旧的 fume 模式迁移为单句样式', () => {
    expect(migrateVisualSettings({ visualMode: 'fume' })).toEqual({
      visualMode: 'fume',
      fumeStyle: 'sentence',
    });
  });

  it('新配置原样保留', () => {
    expect(
      migrateVisualSettings({ visualMode: 'fume', fumeStyle: 'glyph' })
    ).toEqual({ visualMode: 'fume', fumeStyle: 'glyph' });
    expect(migrateVisualSettings({ visualMode: 'off' })).toEqual({
      visualMode: 'off',
      fumeStyle: 'sentence',
    });
  });

  it('非法值回落', () => {
    expect(
      migrateVisualSettings({ visualMode: 'bogus', fumeStyle: 'x' })
    ).toEqual({ visualMode: 'off', fumeStyle: 'sentence' });
    expect(normalizeFumeStyle('glyph')).toBe('glyph');
    expect(normalizeFumeStyle(null)).toBe('sentence');
  });
});
