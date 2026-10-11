// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { detectFormat, parseLyricPayload } from '@/lyrics/core/parse';
import { parseLrc } from '@/lyrics/core/adapters/lrc';
import { parseYrc } from '@/lyrics/core/adapters/yrc';
import { parseTtml } from '@/lyrics/core/adapters/ttml';
import { resolveTiers } from '@/lyrics/sources/resolve';

/* ─────────────────────────── 夹具 ─────────────────────────── */

/** yrc 夹具：取自网易 /lyric/new 的真实格式（含 JSON 元数据行 + 逐字 + 逐字翻译） */
const YRC_FIXTURE = {
  yrc: {
    lyric: [
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"宇多田ヒカル"}]}',
      '[20570,1900](20570,360,0)初(20930,150,0)め(21080,120,0)て',
      '[22760,2130](22760,210,0)な(22970,160,0)ん(23130,70,0)て',
    ].join('\n'),
  },
  ytlrc: { lyric: '[00:20.570]第一次\n[00:22.760]什么' },
  yromalrc: { lyric: '[00:20.570]hajimete' },
};

/** TTML 夹具：取自 amll-ttml-db 的规范示例（含逐字 / 翻译 / 罗马音 / 背景人声） */
const TTML_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal"
    xmlns:amll="http://www.example.com/ns/amll" itunes:timing="Word">
  <head>
    <metadata>
      <ttm:agent type="person" xml:id="v1"/>
      <amll:meta key="musicName" value="君の知らない物語"/>
      <amll:meta key="artists" value="supercell"/>
      <amll:meta key="ncmMusicId" value="594221"/>
      <amll:meta key="ttmlAuthorGithubLogin" value="TestAuthor"/>
    </metadata>
  </head>
  <body>
    <div>
      <p begin="00:25.100" end="00:32.500" itunes:key="L1" ttm:agent="v1">
        <span begin="00:25.100" end="00:25.800">君</span>
        <span begin="00:25.900" end="00:26.100">の</span>
        <span begin="00:26.300" end="00:27.600">知らない</span>
        <span ttm:role="x-translation" xml:lang="zh-CN">你所不知道的物语</span>
        <span ttm:role="x-translation" xml:lang="en">The Story You Don't Know</span>
        <span ttm:role="x-roman" xml:lang="ja-Latn">kimi no shiranai monogatari</span>
        <span ttm:role="x-bg" begin="00:30.500" end="00:32.500">
          <span begin="00:30.500" end="00:31.500">(秘密</span>
          <span begin="00:31.600" end="00:32.500">だよ)</span>
        </span>
      </p>
    </div>
  </body>
</tt>`;

/* ─────────────────────── 格式探测 ─────────────────────── */

describe('detectFormat', () => {
  it('识别 TTML', () => {
    expect(detectFormat(TTML_FIXTURE)).toBe('ttml');
    expect(detectFormat('  <tt xmlns="x"><body/></tt>')).toBe('ttml');
  });

  it('识别 yrc（行头 [起始,时长](词起始,词时长,标志)）', () => {
    expect(detectFormat(YRC_FIXTURE.yrc.lyric)).toBe('yrc');
  });

  it('识别行级 LRC', () => {
    expect(detectFormat('[00:01.50]普通歌词')).toBe('lrc');
    expect(detectFormat('[01:02]无毫秒')).toBe('lrc');
  });

  it('无法识别时返回 null', () => {
    expect(detectFormat('')).toBeNull();
    expect(detectFormat('   ')).toBeNull();
    expect(detectFormat('纯文本没有时间戳')).toBeNull();
  });
});

/* ─────────────────────── LRC（兜底档）─────────────────────── */

describe('parseLrc（行级兜底）', () => {
  it('解析行级歌词，并把整行作为单个"词"', () => {
    const data = parseLrc({ lrc: { lyric: '[00:01.00]第一行\n[00:03.00]第二行' } });
    expect(data.lines).toHaveLength(2);
    expect(data.lines[0].words).toHaveLength(1);
    expect(data.lines[0].words[0].text).toBe('第一行');
    expect(data.lines[0].startTime).toBeCloseTo(1, 3);
    // 行结束时间取下一行起点（末行 +5 秒兜底）
    expect(data.lines[0].endTime).toBeCloseTo(3, 3);
    expect(data.lines[1].endTime).toBeCloseTo(8, 3);
  });

  it('按时间戳对齐翻译与罗马音', () => {
    const data = parseLrc({
      lrc: { lyric: '[00:01.00]原文' },
      tlyric: { lyric: '[00:01.00]译文' },
      romalrc: { lyric: '[00:01.00]romaji' },
    });
    expect(data.lines[0].translation).toBe('译文');
    expect(data.lines[0].roman).toBe('romaji');
  });

  it('标记为无逐字能力，来源为 netease-lrc', () => {
    const data = parseLrc({ lrc: { lyric: '[00:01.00]x' } });
    expect(data.hasWordTiming).toBe(false);
    expect(data.format).toBe('lrc');
    expect(data.source).toBe('netease-lrc');
  });

  it('空歌词返回 null', () => {
    expect(parseLrc({ lrc: { lyric: '' } })).toBeNull();
    expect(parseLrc(null)).toBeNull();
  });
});

/* ───────────────────── yrc（网易逐字）───────────────────── */

describe('parseYrc（网易逐字）', () => {
  it('按词切分并换算成秒', () => {
    const data = parseYrc(YRC_FIXTURE);
    expect(data.format).toBe('yrc');
    expect(data.hasWordTiming).toBe(true);

    const first = data.lines[0];
    expect(first.words.map(w => w.text)).toEqual(['初', 'め', 'て']);
    expect(first.words[0].startTime).toBeCloseTo(20.57, 3);
    expect(first.words[0].endTime).toBeCloseTo(20.93, 3);
    expect(first.startTime).toBeCloseTo(20.57, 3);
  });

  it('跳过行首的 JSON 元数据行（作曲/编曲等）', () => {
    const data = parseYrc(YRC_FIXTURE);
    // 夹具里 3 行输入，其中 1 行是 JSON 元数据 → 只应有 2 行歌词
    expect(data.lines).toHaveLength(2);
    expect(data.lines.some(l => l.words[0].text.includes('作词'))).toBe(false);
  });

  it('按最近时间戳对齐逐字翻译与罗马音', () => {
    const data = parseYrc(YRC_FIXTURE);
    expect(data.lines[0].translation).toBe('第一次');
    expect(data.lines[1].translation).toBe('什么');
    expect(data.lines[0].roman).toBe('hajimete');
  });

  it('没有 yrc 字段时返回 null（交给下一档）', () => {
    expect(parseYrc({ lrc: { lyric: '[00:01.00]x' } })).toBeNull();
    expect(parseYrc({})).toBeNull();
  });
});

/* ────────────────────── TTML（首选档）────────────────────── */

describe('parseTtml（AMLL TTML）', () => {
  it('解析逐字歌词并换算成秒', () => {
    const data = parseTtml(TTML_FIXTURE);
    expect(data.format).toBe('ttml');
    expect(data.source).toBe('amll');
    expect(data.hasWordTiming).toBe(true);

    const line = data.lines[0];
    expect(line.words.map(w => w.text)).toEqual(['君', 'の', '知らない']);
    expect(line.words[0].startTime).toBeCloseTo(25.1, 3);
    expect(line.words[2].endTime).toBeCloseTo(27.6, 3);
  });

  it('按语言偏好挑选翻译（zh 优先于 en）', () => {
    const data = parseTtml(TTML_FIXTURE);
    expect(data.lines[0].translation).toBe('你所不知道的物语');
  });

  it('解析罗马音', () => {
    const data = parseTtml(TTML_FIXTURE);
    expect(data.lines[0].roman).toBe('kimi no shiranai monogatari');
  });

  it('背景人声作为独立行并带 background 标记', () => {
    const data = parseTtml(TTML_FIXTURE);
    const bg = data.lines.filter(l => l.background);
    expect(bg).toHaveLength(1);
    // 夹具里写的是 "(秘密" / "だよ)"，但 AMLL 解析器会去掉这层括号 ——
    // 背景性质已由 isBG 标记承载，括号只是给人看的书写约定（见 TTML 规范）
    expect(bg[0].words.map(w => w.text)).toEqual(['秘密', 'だよ']);
    expect(bg[0].startTime).toBeCloseTo(30.5, 3);
  });

  it('提取校对者署名（用于界面致谢）', () => {
    const data = parseTtml(TTML_FIXTURE);
    expect(data.attribution).toBe('TestAuthor');
  });

  it('格式异常时返回 null 而不是抛错（社区提交的 TTML 存在个别问题）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseTtml('<tt 这不是合法 XML')).toBeNull();
    spy.mockRestore();
  });

  it('非 TTML 输入直接返回 null', () => {
    expect(parseTtml('[00:01.00]这是 LRC')).toBeNull();
    expect(parseTtml('')).toBeNull();
  });
});

/* ───────────────── 格式分派与三级降级 ───────────────── */

describe('parseLyricPayload（格式分派）', () => {
  it('纯文本按内容自动分派', () => {
    expect(parseLyricPayload(TTML_FIXTURE).source).toBe('amll');
    expect(parseLyricPayload(YRC_FIXTURE.yrc.lyric).format).toBe('yrc');
    expect(parseLyricPayload('[00:01.00]x').format).toBe('lrc');
    expect(parseLyricPayload('无法识别的内容')).toBeNull();
  });

  it('网易响应对象优先取逐字，没有再退回行级', () => {
    expect(parseLyricPayload(YRC_FIXTURE).format).toBe('yrc');
    // 只有行级歌词的响应（老接口 /lyric 的形状）
    const lrcOnly = { lrc: { lyric: '[00:01.00]x' }, tlyric: { lyric: '' } };
    expect(parseLyricPayload(lrcOnly).format).toBe('lrc');
  });
});

describe('resolveTiers（降级链）', () => {
  const ok = (source, text) => async () => ({
    lines: [{ words: [{ text, startTime: 0, endTime: 1 }], startTime: 0, endTime: 1 }],
    format: 'lrc',
    source,
    hasWordTiming: false,
  });

  it('优先使用第一档', async () => {
    const data = await resolveTiers([
      { id: 'amll', load: ok('amll', 'AMLL') },
      { id: 'netease-yrc', load: ok('netease-yrc', 'YRC') },
    ]);
    expect(data.source).toBe('amll');
  });

  it('第一档返回 null 时降级到下一档', async () => {
    const data = await resolveTiers([
      { id: 'amll', load: async () => null },
      { id: 'netease-yrc', load: ok('netease-yrc', 'YRC') },
    ]);
    expect(data.source).toBe('netease-yrc');
  });

  it('某一档抛错时不影响后续档（歌词失败不该中断播放）', async () => {
    const onFallback = vi.fn();
    const data = await resolveTiers(
      [
        {
          id: 'amll',
          load: async () => {
            throw new Error('网络错误');
          },
        },
        { id: 'netease-lrc', load: ok('netease-lrc', 'LRC') },
      ],
      onFallback
    );
    expect(data.source).toBe('netease-lrc');
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('返回空行数组也视为无内容，继续降级', async () => {
    const data = await resolveTiers([
      {
        id: 'amll',
        load: async () => ({ lines: [], format: 'ttml', source: 'amll', hasWordTiming: true }),
      },
      { id: 'netease-lrc', load: ok('netease-lrc', 'LRC') },
    ]);
    expect(data.source).toBe('netease-lrc');
  });

  it('全部失败返回 null（交给界面优雅降级）', async () => {
    const data = await resolveTiers([
      { id: 'amll', load: async () => null },
      { id: 'netease-lrc', load: async () => null },
    ]);
    expect(data).toBeNull();
  });
});
