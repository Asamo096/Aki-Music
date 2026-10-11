// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 封面取色（离线，决策 D9）：把封面 URL 变成一套 CoverTheme。
 *
 * 与 coverTheme.ts 的分工：那边是**纯计算**（调色板 → 主题，可单测），
 * 这边只负责"把封面的颜色取出来"，依赖 node-vibrant 与浏览器图片解码。
 *
 * 取色用项目已有的 node-vibrant（worker 版，歌词页原本就用它取渐变底色），
 * 它给的是经过审美筛选的色板（Vibrant / Muted / Dark* 等），比裸的 k-means
 * 更贴近人的直觉；失败（跨域被污染、网络失败）时返回兜底主题，调用方无需处理 null。
 */
import * as Vibrant from 'node-vibrant/dist/vibrant.worker.min.js';
import {
  buildCoverTheme,
  FALLBACK_COVER_THEME,
  type CoverTheme,
} from './coverTheme';

/** 内存缓存：同一张封面（同一首歌）不重复取色。key 用封面 URL。 */
const themeCache = new Map<string, CoverTheme>();
const THEME_CACHE_LIMIT = 60;

export const getCachedCoverTheme = (coverUrl: string): CoverTheme | undefined =>
  themeCache.get(coverUrl);

const remember = (coverUrl: string, theme: CoverTheme) => {
  themeCache.set(coverUrl, theme);
  if (themeCache.size > THEME_CACHE_LIMIT) {
    const oldest = themeCache.keys().next().value;
    if (oldest !== undefined) themeCache.delete(oldest);
  }
};

export const extractCoverTheme = async (
  coverUrl: string
): Promise<CoverTheme> => {
  if (!coverUrl) return { ...FALLBACK_COVER_THEME };

  const cached = themeCache.get(coverUrl);
  if (cached) return cached;

  try {
    const swatches = await Vibrant.from(coverUrl, {
      colorCount: 8,
      // 取色不需要原图：quality 越大采样越稀，128px 左右足够
      quality: 4,
    }).getPalette();

    const palette = Object.values(swatches)
      .map(swatch => swatch?.hex)
      .filter((hex): hex is string => Boolean(hex));

    const theme = buildCoverTheme(palette);
    remember(coverUrl, theme);
    return theme;
  } catch (error) {
    console.warn('[theme] 封面取色失败，使用兜底主题', error);
    return { ...FALLBACK_COVER_THEME };
  }
};
