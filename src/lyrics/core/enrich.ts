// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 副行文本补全：当高优先级的逐字歌词（AMLL TTML）**没有翻译/罗马音**时，
 * 用网易云 `/lyric` 的 tlyric / romalrc 按时间对齐补上。
 *
 * 为什么需要：旧歌词页只看网易云接口，是一直有翻译的；换成 AMLL 优先之后，
 * 如果 AMLL 那份没带翻译，用户就会觉得"翻译没了"——这是功能倒退，必须补回来。
 *
 * 对齐策略：**先按文本匹配，再按时间兜底**。
 *
 * 为什么不只用时间：AMLL 是人工重打轴的版本，与网易云 LRC 的时间差可以到 1s 以上，
 * 纯时间对齐会大量漏配。而两边歌词文本是一致的（就是同一首歌的词），
 * 归一化（去掉所有空白与标点差异）后按文本查表既准又稳。
 * 文本没匹配上的（例如某一版把两句并成一句）再用最近时间兜底。
 */
import type { LyricData, LyricLine } from '../types';
import { getLineText } from '../utils/text';

export interface MergeSecondaryOptions {
  /** 时间兜底的容差（秒） */
  tolerance?: number;
}

const DEFAULT_TOLERANCE = 0.6;

/** 归一化：去掉所有空白与常见标点差异，只留字面内容用于匹配 */
const normalize = (text: string): string =>
  text.replace(/\s+/g, '').replace(/[·・]/g, '').toLowerCase();

/**
 * 把 source 的翻译/音译按时间合并到 target 上。
 *
 * @returns 新的 LyricData（没有可合并内容时原样返回，保证引用不变）
 */
export function mergeSecondaryText(
  target: LyricData | null,
  source: LyricData | null,
  options: MergeSecondaryOptions = {}
): LyricData | null {
  if (!target || !source || source.lines.length === 0) {
    return target;
  }

  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const { byText, textLines } = indexSource(source.lines);
  // 逐行判断：AMLL 里可能只有部分行有翻译，缺哪行补哪行
  const anyMissingTranslation = target.lines.some(line => !line.translation);
  const anyMissingRoman = target.lines.some(line => !line.roman);
  if (!anyMissingTranslation && !anyMissingRoman) {
    return target;
  }

  let changed = false;
  const lines: LyricLine[] = target.lines.map(line => {
    const needTranslation = anyMissingTranslation && !line.translation;
    const needRoman = anyMissingRoman && !line.roman;
    if (!needTranslation && !needRoman) {
      return line;
    }

    const sameText = byText.get(normalize(getLineText(line)));
    const match =
      (sameText && pickNearest(sameText, line.startTime)) ??
      findNearestByTime(textLines, line.startTime, tolerance);
    if (!match) {
      return line;
    }

    const translation = needTranslation ? match.translation : undefined;
    const roman = needRoman ? match.roman : undefined;
    if (!translation && !roman) {
      return line;
    }

    changed = true;
    return {
      ...line,
      ...(translation ? { translation } : {}),
      ...(roman ? { roman } : {}),
    };
  });

  if (!changed) {
    return target;
  }

  return { ...target, lines };
}

/** 文本 → 带副行文本的源行（同一文本可能出现多次，如重复的副歌） */
function indexSource(lines: LyricLine[]): {
  byText: Map<string, LyricLine[]>;
  textLines: LyricLine[];
} {
  const byText = new Map<string, LyricLine[]>();
  const textLines: LyricLine[] = [];

  for (const line of lines) {
    if (!line.translation && !line.roman) {
      continue;
    }
    textLines.push(line);
    const key = normalize(getLineText(line));
    if (!key) {
      continue;
    }
    const bucket = byText.get(key);
    if (bucket) {
      bucket.push(line);
    } else {
      byText.set(key, [line]);
    }
  }

  return { byText, textLines };
}

/** 在候选里取时间最近的一行（不限容差 —— 文本相同已是很强的证据） */
function pickNearest(lines: LyricLine[], time: number): LyricLine {
  let best = lines[0];
  let bestDistance = Math.abs(best.startTime - time);

  for (const line of lines) {
    const distance = Math.abs(line.startTime - time);
    if (distance < bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }

  return best;
}

/** 按起点找最近的一行（要求该行确实带有副行文本） */
function findNearestByTime(
  lines: LyricLine[],
  time: number,
  tolerance: number
): LyricLine | null {
  let best: LyricLine | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    const distance = Math.abs(line.startTime - time);
    if (distance <= tolerance && distance < bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }

  return best;
}

/** 该歌词是否已经有副行文本（用于判断要不要去补） */
export const hasSecondaryText = (data: LyricData | null): boolean =>
  Boolean(
    data?.lines.some(line => Boolean(line.translation) || Boolean(line.roman))
  );
