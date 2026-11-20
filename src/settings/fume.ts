// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fume 歌词页的设置归一化（V2.2）。
 *
 * 2026-11-20 起 `visualMode` 只有两个值：`off`（默认歌词页）与 `fume`（Fume 歌词页）；
 * 具体呈现方式放到 `fumeStyle`：`sentence`（单句歌词）/ `glyph`（逐字歌词）。
 *
 * 旧版本曾把两种样式直接作为 visualMode（`fume` / `glyph`），这里做一次纯函数迁移，
 * 让老配置在升级后仍保持原来的观感。
 */

export type VisualMode = 'off' | 'fume';
export type FumeStyle = 'sentence' | 'glyph';

export interface VisualSettings {
  visualMode: VisualMode;
  fumeStyle: FumeStyle;
}

export const normalizeFumeStyle = (value: unknown): FumeStyle =>
  value === 'glyph' ? 'glyph' : 'sentence';

/**
 * 把历史配置归一化为 { visualMode, fumeStyle }。
 * - `visualMode: 'glyph'` → Fume 页 + 逐字样式
 * - `visualMode: 'fume'` 且无 fumeStyle → 单句样式
 * - 其余非法值 → 默认歌词页
 */
export const migrateVisualSettings = (settings: {
  visualMode?: unknown;
  fumeStyle?: unknown;
}): VisualSettings => {
  const legacyMode = settings?.visualMode;
  if (legacyMode === 'glyph') {
    return { visualMode: 'fume', fumeStyle: 'glyph' };
  }
  if (legacyMode === 'fume') {
    return {
      visualMode: 'fume',
      fumeStyle: normalizeFumeStyle(settings.fumeStyle),
    };
  }
  return {
    visualMode: 'off',
    fumeStyle: normalizeFumeStyle(settings.fumeStyle),
  };
};
