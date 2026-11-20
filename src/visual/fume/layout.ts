// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fume 模式排版（V2 设计版：单句电影感）。
 *
 * 设计选择（2026-11-20，用户确认）：
 *   - 一次只呈现当前句，超大字、自动缩放适配宽度
 *   - 字形级时间：每个字有自己的出现时刻（由词时间分摊；行级歌词线性分摊）
 *   - 间奏/前奏展示后续 5 句的 overview
 *
 * 这一层是纯函数（字体测量由调用方注入），不接触 Canvas/DOM。
 */
import type { LyricLine } from '@/lyrics/types';
import { getLineSecondaryText } from '@/lyrics/utils/text';

/** 副行类型（none 表示不显示翻译/音译） */
export type FumeSecondary = 'translation' | 'romaPronunciation' | 'none';

export interface FumeGlyph {
  char: string;
  /** 该字的出现时刻（秒） */
  startTime: number;
  wordIndex: number;
  isSpace: boolean;
}

export interface FumeRow {
  glyphs: FumeGlyph[];
  text: string;
  width: number;
}

export interface FumeLineLayout {
  index: number;
  text: string;
  translation: string | null;
  fontSize: number;
  lineHeight: number;
  rows: FumeRow[];
  width: number;
  height: number;
}

export interface FumeOverviewEntry {
  index: number;
  text: string;
  tone: 'current' | 'near' | 'far';
}

export interface FumeOverviewLayout {
  entries: FumeOverviewEntry[];
  fontSize: number;
  lineHeight: number;
}

export interface FumeLayoutOptions {
  /** 最大可用宽度（CSS 像素） */
  maxWidth: number;
  /** 当前句的初始字号 */
  baseFontSize: number;
  /** 自动缩放下限 */
  minFontSize: number;
  /** measure(text) → 宽度（调用方设置好字体后测量） */
  measure: (text: string) => number;
  secondary?: FumeSecondary;
}

const isWideChar = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3000 && code <= 0x303f)
  );
};

/** 按宽度把一串字符切成多行（仅用于超长句的兜底） */
export const wrapChars = (
  chars: string[],
  maxWidth: number,
  measure: (text: string) => number
): string[][] => {
  const rows: string[][] = [];
  let current: string[] = [];
  let currentWidth = 0;
  for (const char of chars) {
    const width = measure(char);
    if (current.length && currentWidth + width > maxWidth) {
      // 拉丁词尽量在空格处回退
      const lastSpace = !isWideChar(char) ? current.lastIndexOf(' ') : -1;
      if (lastSpace > 0) {
        rows.push(current.slice(0, lastSpace));
        current = current.slice(lastSpace + 1).concat(char);
        currentWidth = measure(current.join(''));
        continue;
      }
      rows.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(char);
    currentWidth += width;
  }
  if (current.length) rows.push(current);
  return rows.length ? rows : [['']];
};

/** 自动缩放：从 base 逐步降到 min，仍放不下时返回 min（交给换行兜底） */
export const fitFontSize = (
  text: string,
  options: Pick<
    FumeLayoutOptions,
    'baseFontSize' | 'minFontSize' | 'maxWidth' | 'measure'
  >
): number => {
  const base = Math.max(options.minFontSize, options.baseFontSize);
  if (!text) return base;
  let size = base;
  while (
    size > options.minFontSize &&
    options.measure(text) > options.maxWidth
  ) {
    size -= 2;
  }
  return size;
};

/** 逐字时间：词内按字符数均分；行级歌词整行线性均分 */
export const buildGlyphTimings = (
  line: LyricLine,
  chars: string[]
): FumeGlyph[] => {
  const words = (line.words || []).filter(word => word.text);
  const lineStart = Number(line.startTime) || 0;
  const lineEnd = Math.max(lineStart, Number(line.endTime) || lineStart);

  if (words.length <= 1) {
    const span = Math.max(0.001, lineEnd - lineStart);
    return chars.map((char, index) => ({
      char,
      startTime: lineStart + (span * index) / Math.max(1, chars.length),
      wordIndex: 0,
      isSpace: char === ' ',
    }));
  }

  const glyphs: FumeGlyph[] = [];
  words.forEach((word, wordIndex) => {
    const wordChars = Array.from(word.text);
    const start = Number(word.startTime) || lineStart;
    const end = Math.max(start, Number(word.endTime) || start);
    const span = Math.max(0.001, end - start);
    wordChars.forEach((char, offset) => {
      glyphs.push({
        char,
        startTime: start + (span * offset) / Math.max(1, wordChars.length),
        wordIndex,
        isSpace: char === ' ',
      });
    });
  });
  return glyphs;
};

/** 当前行排版：自动缩放 + 超长兜底换行 + 逐字时间 */
export const layoutFumeLine = (
  line: LyricLine,
  index: number,
  options: FumeLayoutOptions
): FumeLineLayout => {
  const text = (line.words || []).map(word => word.text).join('');
  const chars = Array.from(text);
  const secondary = options.secondary ?? 'translation';
  const translation =
    secondary === 'none' ? null : getLineSecondaryText(line, secondary) || null;

  const fontSize = fitFontSize(text, options);
  const glyphs = buildGlyphTimings(line, chars);

  let rows: string[][];
  if (options.measure(text) <= options.maxWidth) {
    rows = [chars];
  } else {
    rows = wrapChars(chars, options.maxWidth, options.measure);
  }

  let cursor = 0;
  const rowModels: FumeRow[] = rows.map(rowChars => {
    const rowGlyphs = glyphs.slice(cursor, cursor + rowChars.length);
    cursor += rowChars.length;
    return {
      glyphs: rowGlyphs,
      text: rowChars.join(''),
      width: options.measure(rowChars.join('')),
    };
  });

  const lineHeight = Math.round(fontSize * 1.16);
  return {
    index,
    text,
    translation,
    fontSize,
    lineHeight,
    rows: rowModels,
    width: options.measure(text),
    height: Math.max(1, rowModels.length) * lineHeight,
  };
};

/**
 * 间奏/前奏的 overview：取“下一句”开始的 5 句。
 * @param nextIndex 即将播放的行下标（activeIndex<0 时由调用方按时间求出）
 */
export const buildFumeOverview = (
  lines: LyricLine[],
  nextIndex: number,
  options: { fontSize: number; lineHeight: number }
): FumeOverviewLayout => {
  const start = Math.max(0, Math.min(nextIndex, Math.max(0, lines.length - 1)));
  const entries: FumeOverviewEntry[] = [];
  for (let offset = 0; offset < 5; offset += 1) {
    const index = start + offset;
    if (index >= lines.length) break;
    const text = (lines[index].words || []).map(word => word.text).join('');
    if (!text) continue;
    entries.push({
      index,
      text,
      tone: offset === 0 ? 'current' : offset <= 2 ? 'near' : 'far',
    });
  }
  return {
    entries,
    fontSize: options.fontSize,
    lineHeight: options.lineHeight,
  };
};

/** 某一行已经揭示到第几个字形（时间有序，可直接用前缀绘制） */
export const resolveRevealedCount = (row: FumeRow, now: number): number => {
  let count = 0;
  for (const glyph of row.glyphs) {
    if (now >= glyph.startTime) count += 1;
    else break;
  }
  return count;
};

/** 找当前正在打印的字形（用于笔尖光点） */
export const resolveCurrentGlyph = (
  row: FumeRow,
  now: number
): FumeGlyph | null => {
  const count = resolveRevealedCount(row, now);
  return count > 0 ? row.glyphs[count - 1] : null;
};
