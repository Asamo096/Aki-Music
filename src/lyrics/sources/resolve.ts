// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LyricData, LyricSourceId } from '../types';

/**
 * 数据源调度：按优先级依次尝试，谁先给出有效结果就用谁。
 *
 * 设计成「可注入的多档任务」而不是写死三条分支，是为了：
 *   - 单测里可以直接塞假数据验证优先级与降级行为（不需要网络与存储）
 *   - 后续增删数据源（例如 M3 的本地歌词文件）只改装配处
 */

export interface LyricTier {
  id: LyricSourceId;
  /** 取回并解析；无该来源的歌词时返回 null（不是错误） */
  load: () => Promise<LyricData | null>;
}

/**
 * 依次尝试各档数据源。
 *
 * - 单档失败（网络错误、解析异常）只记录日志并继续下一档 —— 歌词不该让播放中断
 * - 全部失败返回 null，由调用方决定 UI 如何优雅降级
 */
export async function resolveTiers(
  tiers: LyricTier[],
  onFallback?: (tier: LyricTier, error: unknown) => void,
  signal?: AbortSignal
): Promise<LyricData | null> {
  for (const tier of tiers) {
    if (signal?.aborted) return null;
    try {
      const data = await tier.load();
      if (data?.lines?.length) return data;
    } catch (error) {
      if (signal?.aborted) return null;
      onFallback?.(tier, error);
    }
  }
  return null;
}
