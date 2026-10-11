// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 网易云歌词噪声过滤（移植自歌词页原有逻辑，改为在引擎侧统一处理）。
 *
 * 处理三类脏数据：
 *   1. "作词 : 无" / "作曲 : 无" —— 无信息的制作人条目
 *   2. 纯音乐（< 10 行且含"纯音乐，请欣赏"）—— 过滤掉与歌手同名的制作人条目
 *   3. 上面过滤后只剩 1 行 —— 判定为没有歌词
 */
import type { LyricLine } from '../types';
import { getLineText } from './text';

const CREDIT_NONE = /^作(词|曲)\s*(:|：)\s*无$/;
const CREDIT_PREFIX = /^作(词|曲)\s*(:|：)\s*/;
export const INSTRUMENTAL_MARKER = '纯音乐，请欣赏';

export interface NeteaseFilterResult {
  lines: LyricLine[];
  /** 是否为纯音乐（UI 可据此显示提示而不是空歌词） */
  instrumental: boolean;
}

/**
 * @param lines       原始歌词行
 * @param artistName  当前曲目的歌手名（用于剔除纯音乐里与歌手同名的制作人条目）
 */
export function filterNeteaseLyricNoise(
  lines: LyricLine[],
  artistName?: string
): NeteaseFilterResult {
  let filtered = lines.filter(line => {
    const text = getLineText(line).trim();
    return text !== '' && !CREDIT_NONE.test(text);
  });

  const instrumental =
    filtered.length <= 10 &&
    filtered.some(line => getLineText(line).trim() === INSTRUMENTAL_MARKER);

  if (instrumental) {
    filtered = filtered.filter(line => {
      const match = getLineText(line).trim().match(CREDIT_PREFIX);
      if (!match) {
        return true;
      }
      return getLineText(line).trim().replace(match[0], '') !== artistName;
    });
  }

  // 只剩"纯音乐，请欣赏"一行 → 视为无歌词（与旧歌词页一致）
  if (instrumental && filtered.length <= 1) {
    return { lines: [], instrumental: true };
  }

  return { lines: filtered, instrumental };
}
