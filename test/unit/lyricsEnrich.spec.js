// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  mergeSecondaryText,
  hasSecondaryText,
} from '@/lyrics/core/enrich';

const line = (startTime, text, extra = {}) => ({
  words: [{ text, startTime, endTime: startTime + 1 }],
  startTime,
  endTime: startTime + 1,
  ...extra,
});

const data = (lines, source = 'amll') => ({
  lines,
  format: 'ttml',
  source,
  hasWordTiming: true,
});

describe('mergeSecondaryText', () => {
  it('把翻译按最近时间补到逐字歌词上，原行其余字段保留', () => {
    const target = data([line(10, 'a'), line(20, 'b'), line(30, 'c')]);
    const source = data(
      [line(10.05, 'a', { translation: '啊' }), line(20.1, 'b', { translation: '波' })],
      'netease-lrc'
    );
    const merged = mergeSecondaryText(target, source);
    expect(merged.lines.map(l => l.translation)).toEqual(['啊', '波', undefined]);
    expect(merged.source).toBe('amll'); // 来源标识不变
    expect(merged.hasWordTiming).toBe(true);
    expect(merged.lines[0].words[0].text).toBe('a'); // 逐字数据没被动过
  });

  it('同时补音译，且不覆盖已有的翻译', () => {
    const target = data([
      line(10, 'a', { translation: '已有翻译' }),
      line(20, 'b'),
    ]);
    const source = data(
      [
        line(10.02, 'a', { translation: '别覆盖我', roman: 'a' }),
        line(20.02, 'b', { translation: '波', roman: 'b' }),
      ],
      'netease-lrc'
    );
    const merged = mergeSecondaryText(target, source);
    expect(merged.lines[0].translation).toBe('已有翻译');
    expect(merged.lines[0].roman).toBe('a');
    expect(merged.lines[1]).toMatchObject({ translation: '波', roman: 'b' });
  });

  it('文本也不同且超出时间容差的行不合并', () => {
    const target = data([line(10, 'a')]);
    const source = data([line(12, 'b', { translation: '太远' })], 'netease-lrc');
    expect(mergeSecondaryText(target, source)).toBe(target); // 没有变化就原样返回
  });

  it('时间对不上时按文本匹配（AMLL 重打轴 vs 网易云 LRC）', () => {
    const target = data([line(10, '吹着前奏望着天空')]);
    const source = data(
      [line(11.8, '吹着前奏望着天空', { translation: '吹着前奏 望着天空' })],
      'netease-lrc'
    );
    expect(mergeSecondaryText(target, source).lines[0].translation).toBe(
      '吹着前奏 望着天空'
    );
  });

  it('文本匹配忽略空白差异（TTML 词里的空格 vs LRC 连写）', () => {
    const target = data([
      { ...line(10, 'x'), words: [{ text: '他们', startTime: 10, endTime: 11 }, { text: ' 说 ', startTime: 11, endTime: 12 }] },
    ]);
    const source = data(
      [line(10.5, '他们说', { translation: '他们说' })],
      'netease-lrc'
    );
    expect(mergeSecondaryText(target, source).lines[0].translation).toBe('他们说');
  });

  it('目标已有全部副行文本时不做任何事（保持同一引用）', () => {
    const target = data([line(10, 'a', { translation: '啊' })]);
    const source = data([line(10, 'a', { translation: '别的' })], 'netease-lrc');
    expect(mergeSecondaryText(target, source)).toBe(target);
  });

  it('源里没有副行文本时不做任何事', () => {
    const target = data([line(10, 'a')]);
    const source = data([line(10, 'a')], 'netease-lrc');
    expect(mergeSecondaryText(target, source)).toBe(target);
  });

  it('空输入安全', () => {
    expect(mergeSecondaryText(null, null)).toBe(null);
    const target = data([line(10, 'a')]);
    expect(mergeSecondaryText(target, null)).toBe(target);
    expect(mergeSecondaryText(null, data([line(1, 'x')]))).toBe(null);
  });

  it('重复时间戳（副歌）在相同文本的候选里取最近的一行', () => {
    const target = data([line(50.4, 'chorus')]);
    const source = data(
      [
        line(50.0, 'chorus', { translation: '第一次' }),
        line(50.5, 'chorus', { translation: '第二次' }),
      ],
      'netease-lrc'
    );
    expect(mergeSecondaryText(target, source).lines[0].translation).toBe('第二次');
  });
});

describe('hasSecondaryText', () => {
  it('有翻译或音译即算有', () => {
    expect(hasSecondaryText(null)).toBe(false);
    expect(hasSecondaryText(data([line(1, 'a')]))).toBe(false);
    expect(hasSecondaryText(data([line(1, 'a', { translation: 'x' })]))).toBe(true);
    expect(hasSecondaryText(data([line(1, 'a', { roman: 'x' })]))).toBe(true);
  });
});
