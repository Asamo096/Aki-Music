// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseLrc } from './adapters/lrc';
import { parseTtml } from './adapters/ttml';
import { parseYrc } from './adapters/yrc';
import type { LyricData, LyricFormat } from '../types';

/**
 * 格式探测与解析入口。
 *
 * 各数据源给回来的东西形态不一（AMLL 是 TTML 字符串、网易 yrc 是带 yrc 字段的对象），
 * 这里统一负责「认出是什么格式」并分派到对应适配器。
 */

/** 依据原文特征判断格式 */
export function detectFormat(raw: string): LyricFormat | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const head = raw.trimStart().slice(0, 200);

  // TTML：XML 文档，根元素为 <tt>
  if (head.startsWith('<tt') || /<tt[\s>]/.test(head)) return 'ttml';

  // yrc：行头形如 [起始ms,时长ms](词起始ms,词时长ms,标志)词
  if (/\[\d+,\d+\]\(\d+,\d+,\d+\)/.test(raw)) return 'yrc';

  // 普通 LRC：[mm:ss.xx]
  if (/\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/.test(raw)) return 'lrc';

  return null;
}

export interface ParseOptions {
  /** 显式指定格式时跳过探测 */
  format?: LyricFormat;
  /** 翻译的语言偏好，例如 ['zh-cn', 'zh'] */
  preferredLangs?: string[];
}

/**
 * 把任一数据源的返回解析为统一的 LyricData。
 *
 * 入参既可以是纯文本（TTML / LRC 全文），也可以是网易的响应对象
 * （含 lrc / tlyric / yrc / ytlrc 等字段）——按内容自动分派。
 *
 * @returns 解析结果；无法识别或无有效歌词行时返回 null
 */
export function parseLyricPayload(
  payload: unknown,
  options: ParseOptions = {}
): LyricData | null {
  if (payload === null || payload === undefined) return null;

  const preferredLangs = options.preferredLangs ?? [];

  // 显式指定格式
  if (options.format === 'ttml') {
    return typeof payload === 'string'
      ? parseTtml(payload, preferredLangs)
      : null;
  }
  if (options.format === 'yrc') return parseYrc(payload);
  if (options.format === 'lrc') return parseLrc(payload);

  // 纯文本：探测后分派
  if (typeof payload === 'string') {
    switch (detectFormat(payload)) {
      case 'ttml':
        return parseTtml(payload, preferredLangs);
      case 'yrc': {
        // 纯文本形式的 yrc：包装成适配器认识的形状
        return parseYrc({ yrc: { lyric: payload } });
      }
      case 'lrc':
        return parseLrc(payload);
      default:
        return null;
    }
  }

  // 网易响应对象：优先逐字，其次行级
  return parseYrc(payload) ?? parseLrc(payload);
}
