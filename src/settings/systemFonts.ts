// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 本机字体读取（Local Font Access）—— 单点实现。
 *
 * 之前设置页的字体选择器与远程窗的齿轮面板各自写了一遍"读取 → 去重 → 测可用性"，
 * 合并到这里，两处共用同一份缓存与判定逻辑。
 *
 * 注意：`queryLocalFonts()` 要求页面可见（Chromium 的硬性要求），并且每个窗口
 * 有自己的模块实例与缓存（主窗口、远程窗各一份），这是有意的：远程窗独立打开时
 * 不需要等主窗口读一次。
 */
import { isFontFamilyAvailableCached } from './fontAvailability';

export interface SystemFontEntry {
  family: string;
  /** 可直接写进 style.fontFamily 的值（含引号转义） */
  cssFamily: string;
  /** 画布测量判定为"装了但量不出来" */
  unavailable: boolean;
}

const quoteFamily = (family: string): string =>
  `"${family.replace(/["\\]/g, '\\$&')}"`;

let cache: SystemFontEntry[] | null = null;
let loadingPromise: Promise<SystemFontEntry[]> | null = null;

export const getCachedSystemFonts = (): SystemFontEntry[] | null => cache;

export const isSystemFontsLoaded = (): boolean => cache !== null;

/**
 * 读取本机字体（首次会触发授权；Electron 默认授予）。
 * 并发调用会复用同一次请求。
 */
export const loadSystemFonts = async (): Promise<SystemFontEntry[]> => {
  if (cache) return cache;
  if (loadingPromise) return loadingPromise;

  const queryLocalFonts =
    typeof window !== 'undefined' &&
    typeof (window as any).queryLocalFonts === 'function'
      ? (window as any).queryLocalFonts.bind(window)
      : null;
  if (!queryLocalFonts) {
    throw new Error('unsupported');
  }

  loadingPromise = (async () => {
    const list = (await queryLocalFonts()) as Array<{ family?: string }>;
    const seen = new Map<string, SystemFontEntry>();
    for (const item of list) {
      const family = (item.family || '').trim();
      if (!family) continue;
      const key = family.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.set(key, {
        family,
        cssFamily: quoteFamily(family),
        unavailable: !isFontFamilyAvailableCached(family),
      });
    }
    cache = [...seen.values()].sort((a, b) => a.family.localeCompare(b.family));
    return cache;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
};

/** 按关键字过滤（大小写不敏感） */
export const filterSystemFonts = (
  fonts: SystemFontEntry[],
  query: string
): SystemFontEntry[] => {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return fonts;
  return fonts.filter(font =>
    font.family.toLocaleLowerCase().includes(keyword)
  );
};
