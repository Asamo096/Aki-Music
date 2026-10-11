// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 逐字进度计算 —— 渲染层每帧调用，必须是纯函数且无分配。
 * folia 的逐字效果（渐变扫过）就是靠"每个词一个 0..1 的进度"驱动的。
 */
import type { WordRevealMode } from './renderHints';

export interface WordTimingLike {
  startTime: number;
  endTime: number;
}

/**
 * 词在 time 时刻的演唱进度（0..1）。
 * 时长为 0 的词（占位/重叠数据）按时点二值处理，避免除零。
 */
export function getWordProgress(word: WordTimingLike, time: number): number {
  const duration = word.endTime - word.startTime;
  if (!(duration > 0)) {
    return time >= word.startTime ? 1 : 0;
  }
  const progress = (time - word.startTime) / duration;
  return progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
}

/**
 * 按行级 reveal 档位量化进度：
 * - micro（极短行）→ instant：直接 0/1，不做扫过动画（否则每个词都在闪）
 * - short → fast / normal → normal：保持连续
 */
export function applyWordRevealMode(
  progress: number,
  mode: WordRevealMode
): number {
  if (mode === 'instant') {
    return progress > 0 ? 1 : 0;
  }
  return progress;
}
