// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { parseLyric, lyricParser } from '@/utils/lyrics';

describe('parseLyric', () => {
  it('解析基本 LRC 行（分钟 + 秒 + 毫秒）', () => {
    const parsed = parseLyric('[00:01.50]第一行\n[00:03.00]第二行');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ content: '第一行', time: 1.5 });
    expect(parsed[1].time).toBe(3);
  });

  it('一行带多个时间戳时展开为多条', () => {
    const parsed = parseLyric('[00:01.00][00:05.00]重复');
    expect(parsed.map(l => l.time)).toEqual([1, 5]);
    expect(parsed.every(l => l.content === '重复')).toBe(true);
  });

  it('乱序输入按时间升序排列（二分插入保证有序）', () => {
    const parsed = parseLyric('[00:10.00]晚\n[00:02.00]早\n[00:06.00]中');
    expect(parsed.map(l => l.content)).toEqual(['早', '中', '晚']);
  });

  it('毫秒截断到两位（与上游实现一致）', () => {
    const parsed = parseLyric('[00:00.123]x');
    expect(parsed[0].time).toBeCloseTo(0.12, 5);
    expect(parsed[0].rawTime).toBe('[00:00.12]');
  });

  it('保留原始时间戳文本（供界面展示/复制）', () => {
    expect(parseLyric('[01:02.30]x')[0].rawTime).toBe('[01:02.30]');
  });

  it('空输入、纯文本、只有时间戳没有内容都返回空数组', () => {
    expect(parseLyric('')).toEqual([]);
    expect(parseLyric('没有时间戳的纯文本')).toEqual([]);
    expect(parseLyric('[00:01.00]')).toEqual([]);
  });
});

describe('lyricParser', () => {
  it('同时解析原文 / 翻译 / 罗马音，并透传作者信息', () => {
    const parsed = lyricParser({
      lrc: { lyric: '[00:01.00]原文' },
      tlyric: { lyric: '[00:01.00]translation' },
      romalrc: { lyric: '[00:01.00]romaji' },
      lyricUser: { nickname: '译者A' },
      transUser: { nickname: '译者B' },
    });
    expect(parsed.lyric[0].content).toBe('原文');
    expect(parsed.tlyric[0].content).toBe('translation');
    expect(parsed.romalyric[0].content).toBe('romaji');
    expect(parsed.lyricuser).toEqual({ nickname: '译者A' });
    expect(parsed.transuser).toEqual({ nickname: '译者B' });
  });

  it('缺少字段时安全降级为空数组（纯音乐 / 无翻译）', () => {
    const parsed = lyricParser({});
    expect(parsed.lyric).toEqual([]);
    expect(parsed.tlyric).toEqual([]);
    expect(parsed.romalyric).toEqual([]);
  });
});
