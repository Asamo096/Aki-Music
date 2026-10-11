// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseLyric } from '@/utils/lyrics';
import type { LyricData, LyricLine } from '../../types';

/**
 * 行级 LRC 适配器（兜底数据源）。
 *
 * 上游已有成熟的 LRC 解析器（`utils/lyrics.js` 的 parseLyric，带二分插入排序），
 * 这里直接复用，只负责把它归一成 LyricData，并按**时间戳**对齐翻译与罗马音
 * （与现有歌词页 `lyricWithTranslation` 的做法一致）。
 */

/** parseLyric 的输出形状（utils/lyrics.js 是 JS，这里显式声明） */
interface ParsedLrcLine {
  rawTime: string;
  time: number;
  content: string;
}

/** 把 parseLyric 的结果按 rawTime 建索引，用于对齐翻译/罗马音 */
const indexByRawTime = (parsed: ParsedLrcLine[]) => {
  const map = new Map();
  for (const item of parsed) {
    if (item.content) map.set(item.rawTime, item.content);
  }
  return map;
};

/**
 * @param lrc     网易云 /lyric 的响应体（含 lrc / tlyric / romalrc；也接受纯 LRC 字符串）
 * @returns 解析结果；无有效歌词行时返回 null
 */
export function parseLrc(lrc: unknown): LyricData | null {
  const payload =
    typeof lrc === 'string' ? { lrc: { lyric: lrc } } : (lrc as any);
  if (!payload) return null;

  const parsed = parseLyric(payload.lrc?.lyric ?? '');
  if (!parsed.length) return null;

  const translations = indexByRawTime(parseLyric(payload.tlyric?.lyric ?? ''));
  const romans = indexByRawTime(
    parseLyric(payload.romalrc?.lyric ?? payload.yromalrc?.lyric ?? '')
  );

  const lines: LyricLine[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const { rawTime, time, content } = parsed[i];
    if (!content) continue;
    // 行级歌词没有行结束时间，用下一行起点近似；末行给 5 秒兜底
    const next = parsed[i + 1];
    const endTime = next ? next.time : time + 5;

    lines.push({
      words: [{ text: content, startTime: time, endTime }],
      startTime: time,
      endTime,
      translation: translations.get(rawTime),
      roman: romans.get(rawTime),
    });
  }

  if (!lines.length) return null;
  return { lines, format: 'lrc', source: 'netease-lrc', hasWordTiming: false };
}
