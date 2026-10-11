// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 当前行判定。
 *
 * 语义：**最后一个 startTime ≤ time 的行**；早于首行返回 -1。
 * 也就是 pos ∈ [line[i].startTime, line[i+1].startTime) 时命中 i —— 与行级歌词页
 * 原有的判定（`progress >= l.time && progress < next.time`）完全一致。
 *
 * 注意这里**不用 renderHints.renderEndTime**：renderEndTime 是给视觉层的
 * "可以多留一会儿"窗口（见 renderHints.ts 的注释），如果用它做判定，相邻行的
 * 高亮区间会重叠，导致下一行已经开唱、上一行还亮着。
 *
 * 桌面歌词 / 远程控制窗口每帧都要判定，故用二分查找。
 */
import type { LyricLine } from '../types';

export function findActiveLineIndex(
  lines: Pick<LyricLine, 'startTime'>[] | null | undefined,
  time: number
): number {
  if (!lines || lines.length === 0) {
    return -1;
  }

  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].startTime <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}
