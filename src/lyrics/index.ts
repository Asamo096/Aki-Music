// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 歌词引擎入口。
 *
 * 用法：
 *   import { loadLyrics } from '@/lyrics';
 *   const data = await loadLyrics(track.id, { preferredLangs: ['zh-cn'] });
 *
 * 三级数据源，按质量优先：
 *   ① AMLL TTML DB（人工校对，含翻译/罗马音/背景人声）
 *   ② 网易云逐字歌词（yrc）
 *   ③ 网易云行级歌词（兜底）
 * 任一级失败或没有内容都会自动降级，全部失败返回 null（由 UI 优雅降级）。
 *
 * 本模块及其依赖**不引入 Vue / DOM**，可独立测试与复用（见 test/unit/lyricsEngine.spec.js）。
 */
import type { LyricData, LyricSourceId } from './types';
import { resolveTiers, type LyricTier } from './sources/resolve';
import { loadAmllLyrics } from './sources/amll';
import { loadNeteaseLrc, loadNeteaseYrc } from './sources/netease';

export type {
  LyricData,
  LyricLine,
  LyricWord,
  LyricFormat,
  LyricSourceId,
} from './types';
export { SOURCE_LABELS } from './types';
export { detectFormat, parseLyricPayload } from './core/parse';
export { resolveTiers, type LyricTier } from './sources/resolve';

export interface LoadLyricsOptions {
  /** 翻译的语言偏好（按优先级），例如 ['zh-cn', 'zh'] */
  preferredLangs?: string[];
  /** 是否跳过 AMLL（例如用户只想用网易云官方歌词） */
  skipAmll?: boolean;
  /** 降级时的回调，便于埋点/调试 */
  onFallback?: (source: LyricSourceId, error: unknown) => void;
}

/** 按优先级装配各档数据源 */
function buildTiers(
  trackId: string | number,
  options: LoadLyricsOptions
): LyricTier[] {
  const { preferredLangs = [], skipAmll = false } = options;
  const tiers: LyricTier[] = [];

  if (!skipAmll) {
    tiers.push({
      id: 'amll',
      load: () => loadAmllLyrics(trackId, preferredLangs),
    });
  }
  tiers.push({ id: 'netease-yrc', load: () => loadNeteaseYrc(trackId) });
  tiers.push({ id: 'netease-lrc', load: () => loadNeteaseLrc(trackId) });
  return tiers;
}

/**
 * 取一首歌的歌词（三级降级）。
 *
 * @returns 解析结果；全部来源都没有时返回 null
 */
export async function loadLyrics(
  trackId: string | number,
  options: LoadLyricsOptions = {}
): Promise<LyricData | null> {
  const { onFallback } = options;
  return resolveTiers(buildTiers(trackId, options), (tier, error) => {
    console.warn(`[lyrics] ${tier.id} 取词失败，降级到下一档`, error);
    onFallback?.(tier.id, error);
  });
}
