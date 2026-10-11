// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { findActiveLineIndex } from '@/lyrics/timing/activeLine';
import {
  getWordProgress,
  applyWordRevealMode,
} from '@/lyrics/timing/wordProgress';
import { filterNeteaseLyricNoise } from '@/lyrics/utils/neteaseFilter';
import { getLineText, getLineSecondaryText } from '@/lyrics/utils/text';

const line = (startTime, endTime, text = 'x') => ({
  words: [{ text, startTime, endTime }],
  startTime,
  endTime,
});

/* ───────────────── findActiveLineIndex（当前行判定）───────────────── */

describe('findActiveLineIndex', () => {
  const lines = [line(0, 1), line(1, 2), line(2, 3), line(5, 6)];

  it('空歌词返回 -1', () => {
    expect(findActiveLineIndex([], 3)).toBe(-1);
    expect(findActiveLineIndex(null, 3)).toBe(-1);
    expect(findActiveLineIndex(undefined, 3)).toBe(-1);
  });

  it('早于第一行返回 -1（前奏）', () => {
    expect(findActiveLineIndex([line(4, 5)], 0)).toBe(-1);
    expect(findActiveLineIndex([line(4, 5)], 3.999)).toBe(-1);
  });

  it('按行起点判定，行边界归下一行之外的前一行', () => {
    expect(findActiveLineIndex(lines, 0)).toBe(0);
    expect(findActiveLineIndex(lines, 0.999)).toBe(0);
    expect(findActiveLineIndex(lines, 1)).toBe(1); // 边界给后一行
    expect(findActiveLineIndex(lines, 2.5)).toBe(2);
  });

  it('行间空隙仍停在上一行（间奏不会闪回前一行）', () => {
    expect(findActiveLineIndex(lines, 4.2)).toBe(2);
  });

  it('超过末行时间仍然命中末行', () => {
    expect(findActiveLineIndex(lines, 99)).toBe(3);
  });

  it('与线性查找结果一致（随机对拍）', () => {
    for (let t = -1; t < 7; t += 0.25) {
      const expected = lines.reduce(
        (acc, l, i) => (t >= l.startTime ? i : acc),
        -1
      );
      expect(findActiveLineIndex(lines, t)).toBe(expected);
    }
  });
});

/* ───────────────── getWordProgress（逐字进度）───────────────── */

describe('getWordProgress', () => {
  const word = { startTime: 10, endTime: 12 };

  it('开始前 0、结束后 1、中间线性', () => {
    expect(getWordProgress(word, 9)).toBe(0);
    expect(getWordProgress(word, 10)).toBe(0);
    expect(getWordProgress(word, 11)).toBe(0.5);
    expect(getWordProgress(word, 12)).toBe(1);
    expect(getWordProgress(word, 15)).toBe(1);
  });

  it('零时长词按时点二值化（不产生除零/NaN）', () => {
    const instant = { startTime: 3, endTime: 3 };
    expect(getWordProgress(instant, 2.9)).toBe(0);
    expect(getWordProgress(instant, 3)).toBe(1);
    expect(Number.isNaN(getWordProgress(instant, 3))).toBe(false);
  });
});

describe('applyWordRevealMode', () => {
  it('instant（micro 行）量化为 0/1', () => {
    expect(applyWordRevealMode(0, 'instant')).toBe(0);
    expect(applyWordRevealMode(0.4, 'instant')).toBe(1);
  });

  it('normal / fast 保持连续', () => {
    expect(applyWordRevealMode(0.42, 'normal')).toBe(0.42);
    expect(applyWordRevealMode(0.42, 'fast')).toBe(0.42);
  });
});

/* ───────────────── 文本推导 ───────────────── */

describe('getLineText / getLineSecondaryText', () => {
  it('原文按词拼接', () => {
    expect(
      getLineText({
        words: [
          { text: 'Hello', startTime: 0, endTime: 1 },
          { text: ' world', startTime: 1, endTime: 2 },
        ],
      })
    ).toBe('Hello world');
  });

  it('副行取翻译或音译，缺失返回空串', () => {
    const l = { translation: '你好', roman: 'ni hao' };
    expect(getLineSecondaryText(l, 'translation')).toBe('你好');
    expect(getLineSecondaryText(l, 'romaPronunciation')).toBe('ni hao');
    expect(getLineSecondaryText({}, 'translation')).toBe('');
    expect(getLineSecondaryText({}, 'romaPronunciation')).toBe('');
  });
});

/* ───────────────── filterNeteaseLyricNoise（脏数据过滤）───────────────── */

describe('filterNeteaseLyricNoise', () => {
  it('剔除空行与"作词 : 无"', () => {
    const result = filterNeteaseLyricNoise([
      line(0, 1, '作词 : 无'),
      line(1, 2, '作曲 : 无'),
      line(2, 3, '  '),
      line(3, 4, '真正的歌词'),
    ]);
    expect(result.instrumental).toBe(false);
    expect(result.lines.map(getLineText)).toEqual(['真正的歌词']);
  });

  it('纯音乐：只剔除与歌手同名的制作人条目', () => {
    const result = filterNeteaseLyricNoise(
      [
        line(0, 1, '作词 : 张三'),
        line(1, 2, '作曲 : 李四'),
        line(2, 3, '纯音乐，请欣赏'),
      ],
      '张三'
    );
    expect(result.instrumental).toBe(true);
    expect(result.lines.map(getLineText)).toEqual([
      '作曲 : 李四',
      '纯音乐，请欣赏',
    ]);
  });

  it('纯音乐：制作人条目全被剔除后只剩标记 → 判为无歌词', () => {
    const result = filterNeteaseLyricNoise(
      [
        line(0, 1, '作词 : 张三'),
        line(1, 2, '作曲 : 张三'),
        line(2, 3, '纯音乐，请欣赏'),
      ],
      '张三'
    );
    expect(result.instrumental).toBe(true);
    expect(result.lines).toEqual([]);
  });

  it('纯音乐但制作人与歌手不同名时保留', () => {
    const result = filterNeteaseLyricNoise(
      [line(0, 1, '作词 : 李四'), line(1, 2, '纯音乐，请欣赏')],
      '张三'
    );
    expect(result.instrumental).toBe(true);
    expect(result.lines.map(getLineText)).toEqual(['作词 : 李四', '纯音乐，请欣赏']);
  });

  it('只剩纯音乐标记一行 → 判为无歌词', () => {
    const result = filterNeteaseLyricNoise(
      [line(0, 1, '纯音乐，请欣赏')],
      '张三'
    );
    expect(result.instrumental).toBe(true);
    expect(result.lines).toEqual([]);
  });

  it('行数多于 10 时不做纯音乐判定', () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      line(i, i + 1, i === 0 ? '纯音乐，请欣赏' : `歌词${i}`)
    );
    const result = filterNeteaseLyricNoise(many, '张三');
    expect(result.instrumental).toBe(false);
    expect(result.lines).toHaveLength(11);
  });
});
