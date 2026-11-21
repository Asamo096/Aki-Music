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
import type { RequestPriority } from '@/net/requestScheduler';
import { resolveTiers, type LyricTier } from './sources/resolve';
import { loadAmllLyrics } from './sources/amll';
import { loadNeteaseLrc, loadNeteaseYrc } from './sources/netease';
import { ensureLyricDataRenderHints } from './timing/renderHints';
import { hasSecondaryText, mergeSecondaryText } from './core/enrich';

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
export { mergeSecondaryText, hasSecondaryText } from './core/enrich';
// 渲染层共用工具（歌词页 / 桌面歌词 / 远程控制窗口走同一个入口）
export { getLineText, getLineSecondaryText } from './utils/text';
export { filterNeteaseLyricNoise } from './utils/neteaseFilter';
export { findActiveLineIndex } from './timing/activeLine';
export { getWordProgress, applyWordRevealMode } from './timing/wordProgress';
export {
  buildLineRenderHints,
  getLineTransitionTiming,
  type LineRenderHints,
} from './timing/renderHints';

export interface LoadLyricsOptions {
  /** 翻译的语言偏好（按优先级），例如 ['zh-cn', 'zh'] */
  preferredLangs?: string[];
  /** 是否跳过 AMLL（例如用户只想用网易云官方歌词） */
  skipAmll?: boolean;
  /** 降级时的回调，便于埋点/调试 */
  onFallback?: (source: LyricSourceId, error: unknown) => void;
  /** 取消信号：切歌/离开页面时中止旧歌词请求 */
  signal?: AbortSignal;
  /** 请求优先级：当前曲目 P0，预取 P2 */
  priority?: RequestPriority;
  /** 调度器作用域标签 */
  group?: string;
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
      load: () => loadAmllLyrics(trackId, preferredLangs, options),
    });
  }
  tiers.push({
    id: 'netease-yrc',
    load: () => loadNeteaseYrc(trackId, options),
  });
  tiers.push({
    id: 'netease-lrc',
    load: () => loadNeteaseLrc(trackId, options),
  });
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
  const { onFallback, signal } = options;
  const data = await resolveTiers(
    buildTiers(trackId, options),
    (tier, error) => {
      console.warn(`[lyrics] ${tier.id} 取词失败，降级到下一档`, error);
      onFallback?.(tier.id, error);
    },
    signal
  );

  if (signal?.aborted) return null;

  // AMLL 那份逐字歌词常常不带翻译/罗马音，而网易云接口有 —— 补回来，
  // 否则相比旧歌词页会"丢翻译"（详见 core/enrich.ts 的注释）。
  const enriched = await enrichSecondaryText(data, trackId, options);

  // 统一在这里补渲染节奏提示，消费方（歌词页/桌面歌词）不必自己记着调用；
  // 已有且一致的 hints 会原样返回（见 renderHints.ts 的 migrate 逻辑）。
  return ensureLyricDataRenderHints(enriched);
}

/** 只有"非网易云行级来源 + 缺副行文本"时才去补，避免重复请求已经用过的接口 */
async function enrichSecondaryText(
  data: LyricData | null,
  trackId: string | number,
  options: LoadLyricsOptions = {}
): Promise<LyricData | null> {
  if (!data || data.source === 'netease-lrc' || hasSecondaryText(data)) {
    return data;
  }

  try {
    const lrc = await loadNeteaseLrc(trackId, options);
    return mergeSecondaryText(data, lrc);
  } catch (error) {
    // 补翻译失败不影响主流程
    console.warn('[lyrics] 补副行文本失败', error);
    return data;
  }
}
