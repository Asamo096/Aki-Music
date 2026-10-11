// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 folia-major（AGPL-3.0，https://github.com/chthollyphile/folia-major）
//   src/utils/lyrics/graphemeTiming.ts
// Modified for Aki Music on 2026-10-11: 适配本项目的数据契约。
//   1. 入参类型由 folia 的 Line/Word 改为本项目的 LyricLine/LyricWord
//   2. 去掉 syllables 分支 —— 本项目采用 AMLL 的简化歌词模型
//      （AmllLyricWord 只到词一级，没有音节时间），因此词内按字素均分
//   3. 原文用 line.fullText，本项目按 words 拼接推导
//
// 作用：把"词级"时间细化到**字素级** —— folia 的字级发光效果靠它实现
// （同一个词里的每个字错峰亮起，比整词一起亮更接近真实演唱）。用 Intl.Segmenter
// 切分，保证 emoji、组合字等也能正确切。

import type { LyricLine, LyricWord } from '../types';
// 行文本推导统一放在 utils/text，这里转出以保持移植文件的对外接口不变
import { getLineText } from '../utils/text';

export { getLineText };

export interface GraphemeTiming {
  char: string;
  startTime: number;
  endTime: number;
  wordIndex?: number;
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** 按字素切分（不可用时退化为按码点切分） */
export const splitLyricGraphemes = (text: string): string[] => {
  if (!text) {
    return [];
  }

  if (graphemeSegmenter) {
    return Array.from(
      graphemeSegmenter.segment(text),
      ({ segment }) => segment
    );
  }

  return Array.from(text);
};

/** 在 [startTime, endTime] 内均分给每个字素 */
const buildEvenGraphemeTimings = (
  text: string,
  startTime: number,
  endTime: number,
  wordIndex?: number
): GraphemeTiming[] => {
  const graphemes = splitLyricGraphemes(text);
  if (graphemes.length === 0) {
    return [];
  }

  const duration = Math.max(endTime - startTime, 0);
  const unitDuration = duration / graphemes.length;

  return graphemes.map((char, index) => ({
    char,
    startTime: startTime + unitDuration * index,
    endTime:
      index === graphemes.length - 1
        ? endTime
        : startTime + unitDuration * (index + 1),
    ...(typeof wordIndex === 'number' ? { wordIndex } : {}),
  }));
};

/** 一个词的字素时间序列 */
export const buildWordGraphemeTimings = (
  word: LyricWord,
  wordIndex?: number
): GraphemeTiming[] =>
  buildEvenGraphemeTimings(word.text, word.startTime, word.endTime, wordIndex);

/**
 * 从源字素序列里找目标子序列的起始下标；找不到返回 -1。
 * 用于把词的时间对齐回"包含空格与标点的整行"，因为解析器给的词里
 * 可能不含这些字符（例如英文歌词的空格、行尾标点）。
 */
const findGraphemeSequence = (
  source: string[],
  target: string[],
  fromIndex: number
): number => {
  if (target.length === 0) {
    return fromIndex;
  }

  for (
    let index = fromIndex;
    index <= source.length - target.length;
    index += 1
  ) {
    let matched = true;
    for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
      if (source[index + targetIndex] !== target[targetIndex]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return index;
    }
  }

  return -1;
};

/**
 * 把词级时间映射回**整行**的字素时间轴（含空格与标点）。
 *
 * 未被任何词覆盖的字素（空格、标点）取上一个已解析时间的末尾，即"瞬时"。
 */
export const buildLineGraphemeTimeline = (
  line: LyricLine
): GraphemeTiming[] => {
  const lineText = getLineText(line);
  const lineGraphemes = splitLyricGraphemes(lineText);
  if (lineGraphemes.length === 0) {
    return [];
  }

  if (line.words.length === 0) {
    return buildEvenGraphemeTimings(lineText, line.startTime, line.endTime);
  }

  const timeline: GraphemeTiming[] = [];
  let cursor = 0;
  let lastResolvedTime = line.startTime;

  line.words.forEach((word, wordIndex) => {
    const wordGraphemes = splitLyricGraphemes(word.text);
    if (wordGraphemes.length === 0) {
      return;
    }

    const matchedStart = findGraphemeSequence(
      lineGraphemes,
      wordGraphemes,
      cursor
    );
    const start = matchedStart >= 0 ? matchedStart : cursor;
    const end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

    // 词与词之间的空隙（空格/标点）：时间取该词起点，即瞬时通过
    for (let gapIndex = cursor; gapIndex < start; gapIndex += 1) {
      timeline[gapIndex] = {
        char: lineGraphemes[gapIndex],
        startTime: word.startTime,
        endTime: word.startTime,
      };
    }

    const wordTimings = buildWordGraphemeTimings(word, wordIndex);
    for (let localIndex = 0; localIndex < end - start; localIndex += 1) {
      const timing =
        wordTimings[localIndex] ??
        buildEvenGraphemeTimings(
          wordGraphemes[localIndex] ?? '',
          word.startTime,
          word.endTime,
          wordIndex
        )[0];

      if (!timing) {
        continue;
      }

      timeline[start + localIndex] = {
        ...timing,
        char: lineGraphemes[start + localIndex],
      };
      lastResolvedTime = Math.max(lastResolvedTime, timing.endTime);
    }

    cursor = Math.max(cursor, end);
  });

  // 仍未被覆盖的字素（异常数据）：挂在最后一个已知时间点上
  for (let index = 0; index < lineGraphemes.length; index += 1) {
    if (timeline[index]) {
      continue;
    }

    timeline[index] = {
      char: lineGraphemes[index],
      startTime: lastResolvedTime,
      endTime: lastResolvedTime,
    };
  }

  return timeline;
};
