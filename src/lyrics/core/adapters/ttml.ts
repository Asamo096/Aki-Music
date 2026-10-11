// SPDX-License-Identifier: AGPL-3.0-or-later
import { TTMLParser, toAmllLyrics } from '@applemusic-like-lyrics/ttml';
import type { LyricData, LyricLine, LyricWord } from '../../types';

/**
 * TTML 适配器（首选数据源）。
 *
 * TTML 是 W3C 定时文本格式，AMLL 在其上扩展了逐字时间、翻译/罗马音/背景人声的角色
 * 标注与 `amll:meta` 元数据（见 amll-ttml-db 的规范）。解析交给官方实现
 * `@applemusic-like-lyrics/ttml`，本文件只负责三件事：
 *
 *   1. **换算单位**：解析器用毫秒，本项目统一用秒
 *   2. **控制翻译语言**：官方提供两段式 API —— `TTMLParser.parse()` 得到富结构，
 *      再用 `toAmllLyrics()` 指定首选语言。便捷函数 `parseTTML()` 不能指定语言，
 *      所以这里走两段式。
 *   3. **容错**：社区提交的 TTML 存在个别格式问题，不能让整个歌词页崩掉
 *
 * 说明：背景人声与对唱在 AMLL 模型里已经是**带标记的独立行**（`isBG` / `isDuet`），
 * 因此这里无需再做展平。
 */

/** 毫秒 → 秒 */
const sec = (ms: number | undefined) => Math.max((ms ?? 0) / 1000, 0);

/**
 * 把本项目的语言设置（如 `zh-CN`、`en`）转成 TTML 里常见的目标语言写法。
 * 解析器在找不到指定语言时会回退到第一条翻译，因此这里做保守映射即可。
 */
function toTtmlLanguage(langs: string[]): string | undefined {
  const first = langs[0]?.toLowerCase();
  if (!first) return undefined;
  if (first.startsWith('zh-tw') || first.startsWith('zh-hk')) return 'zh-Hant';
  if (first.startsWith('zh')) return 'zh-Hans';
  return langs[0];
}

/**
 * @param ttml            TTML 原文
 * @param preferredLangs  期望的翻译语言（按优先级），例如 ['zh-CN']
 * @returns 解析结果；原文异常或无有效歌词行时返回 null（由调用方降级到下一档）
 */
export function parseTtml(
  ttml: string,
  preferredLangs: string[] = []
): LyricData | null {
  if (!ttml || !ttml.includes('<tt')) return null;

  let amll;
  try {
    const rich = TTMLParser.parse(ttml);
    amll = toAmllLyrics(rich, {
      translationLanguage: toTtmlLanguage(preferredLangs),
      romanizationLanguage: undefined,
    });
  } catch (err) {
    // 社区提交的 TTML 偶尔有格式问题；降级而不是抛出
    console.warn('[lyrics] TTML 解析失败，将回退其它数据源', err);
    return null;
  }

  const lines: LyricLine[] = [];
  for (const line of amll.lines ?? []) {
    const words: LyricWord[] = (line.words ?? [])
      .filter(w => w.word !== undefined && w.word !== '')
      .map(w => ({
        text: w.word,
        startTime: sec(w.startTime),
        endTime: sec(w.endTime),
      }));

    // 既没有词也没有整行文本 → 空行，跳过
    if (!words.length) continue;

    lines.push({
      words,
      startTime: sec(line.startTime),
      endTime: sec(line.endTime),
      translation: line.translatedLyric || undefined,
      roman: line.romanLyric || undefined,
      background: line.isBG || undefined,
      duet: line.isDuet || undefined,
    });
  }

  if (!lines.length) return null;
  lines.sort((a, b) => a.startTime - b.startTime);

  const attribution = (amll.metadata ?? []).find(
    ([key]) => key === 'ttmlAuthorGithubLogin'
  )?.[1]?.[0];

  return {
    lines,
    format: 'ttml',
    source: 'amll',
    // 只要有一行被切分成多个词，就认为这份歌词具备逐字能力
    hasWordTiming: lines.some(l => l.words.length > 1),
    attribution: attribution || undefined,
  };
}
