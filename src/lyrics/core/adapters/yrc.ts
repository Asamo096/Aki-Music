// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LyricData, LyricLine, LyricWord } from '../../types';

/**
 * 网易云逐字歌词（yrc）适配器。
 *
 * 数据来自内嵌 API 的 `/lyric/new`（见 ncmModDef 中的 lyric_new 注册）。
 *
 * 格式（实测，详见 docs/接口清单与迁移评估.md 附录 B）：
 *
 *   {"t":0,"c":[{"tx":"作曲: "},{"tx":"柳重言"}]}      ← 可选的 JSON 元数据行，需跳过
 *   [20570,1900](20570,360,0)初(20930,150,0)め…        ← 行： [行起始ms,行时长ms](词起始ms,词时长ms,标志)词…
 *
 * 翻译在 `ytlrc`（行级 LRC 格式）、罗马音在 `yromalrc`。
 */

/** 一行逐字歌词：`[起始,时长](词起始,词时长,标志)词…` */
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
/** 行内的一个词 */
const YRC_WORD = /\((\d+),(\d+),\d+\)([^(]*)/g;

const toSeconds = (ms: string) => Number(ms) / 1000;

/**
 * 解析 yrc 的行级翻译（`ytlrc` 是普通 LRC 格式）为「时间戳 → 文本」索引，
 * 用于与逐字行对齐。
 */
function indexLineLevelLrc(lrc: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!lrc) return map;
  const lineRe = /^\[(\d+):(\d+)(?:[.:](\d+))?\](.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(lrc))) {
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const centis = Number((m[3] ?? '0').slice(0, 2));
    const ms = Math.round((min * 60 + sec + centis / 100) * 1000);
    const text = m[4].trim();
    if (text) map.set(String(ms), text);
  }
  return map;
}

/** 在翻译索引里找与给定毫秒最接近的一条（允许 ±半秒误差） */
function nearest(map: Map<string, string>, ms: number): string | undefined {
  if (map.has(String(ms))) return map.get(String(ms));
  const TOLERANCE = 500;
  let best: string | undefined;
  let bestDiff = Infinity;
  for (const [key, text] of map) {
    const diff = Math.abs(Number(key) - ms);
    if (diff <= TOLERANCE && diff < bestDiff) {
      bestDiff = diff;
      best = text;
    }
  }
  return best;
}

/**
 * @param payload 网易云 `/lyric/new` 的响应体（含 yrc / ytlrc / yromalrc）
 * @returns 解析结果；无逐字歌词时返回 null（由调用方回退到行级 LRC）
 */
export function parseYrc(payload: unknown): LyricData | null {
  const yrc: string = (payload as any)?.yrc?.lyric ?? '';
  if (!yrc) return null;

  const translations = indexLineLevelLrc((payload as any)?.ytlrc?.lyric ?? '');
  const romans = indexLineLevelLrc((payload as any)?.yromalrc?.lyric ?? '');

  const lines: LyricLine[] = [];
  for (const raw of yrc.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // 行首可能出现的 JSON 元数据行（作曲/编曲/制作人）直接跳过
    if (line.startsWith('{')) continue;

    const header = line.match(YRC_LINE);
    if (!header) continue;

    const lineStartMs = Number(header[1]);
    const words: LyricWord[] = [];
    YRC_WORD.lastIndex = 0;
    let w: RegExpExecArray | null;
    while ((w = YRC_WORD.exec(header[3]))) {
      const text = w[3];
      if (!text) continue;
      const start = toSeconds(w[1]);
      words.push({ text, startTime: start, endTime: start + toSeconds(w[2]) });
    }
    if (!words.length) continue;

    const startTime = toSeconds(header[1]);
    const endTime = Math.max(
      startTime + toSeconds(header[2]),
      words.at(-1)!.endTime
    );

    lines.push({
      words,
      startTime,
      endTime,
      translation: nearest(translations, lineStartMs),
      roman: nearest(romans, lineStartMs),
    });
  }

  if (!lines.length) return null;
  return {
    lines,
    format: 'yrc',
    source: 'netease-yrc',
    hasWordTiming: true,
  };
}
