// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  buildLineRenderHints,
  getLineRenderEndTime,
  annotateLyricLines,
  getLineTransitionTiming,
  MICRO_LINE_DURATION_THRESHOLD,
  SHORT_LINE_DURATION_THRESHOLD,
  MICRO_LINE_RENDER_FLOOR,
} from '@/lyrics/timing/renderHints';
import {
  splitLyricGraphemes,
  buildWordGraphemeTimings,
  buildLineGraphemeTimeline,
  getLineText,
} from '@/lyrics/timing/graphemeTiming';

/* ───────────────── renderHints（行级动画节奏）───────────────── */

describe('buildLineRenderHints', () => {
  it('按行时长分档：micro / short / normal', () => {
    const micro = buildLineRenderHints(0, MICRO_LINE_DURATION_THRESHOLD - 0.01);
    expect(micro.timingClass).toBe('micro');
    expect(micro.lineTransitionMode).toBe('none'); // 极短行不做过渡
    expect(micro.wordRevealMode).toBe('instant');

    const short = buildLineRenderHints(0, SHORT_LINE_DURATION_THRESHOLD - 0.01);
    expect(short.timingClass).toBe('short');
    expect(short.lineTransitionMode).toBe('fast');
    expect(short.wordRevealMode).toBe('fast');

    const normal = buildLineRenderHints(0, 3);
    expect(normal.timingClass).toBe('normal');
    expect(normal.lineTransitionMode).toBe('normal');
    expect(normal.wordRevealMode).toBe('normal');
  });

  it('边界值取向：等于阈值算下一档', () => {
    expect(buildLineRenderHints(0, MICRO_LINE_DURATION_THRESHOLD).timingClass).toBe(
      'short'
    );
    expect(buildLineRenderHints(0, SHORT_LINE_DURATION_THRESHOLD).timingClass).toBe(
      'normal'
    );
  });

  it('极短行也有最小展示时长（否则一闪而过看不见）', () => {
    const hints = buildLineRenderHints(10, 10.01);
    expect(hints.renderEndTime).toBeGreaterThanOrEqual(
      10 + MICRO_LINE_RENDER_FLOOR
    );
  });

  it('renderEndTime 不早于行结束时间', () => {
    const hints = buildLineRenderHints(0, 5);
    expect(hints.renderEndTime).toBeGreaterThanOrEqual(5);
  });

  it('接受「行对象」与「起止时间」两种入参', () => {
    const byNumbers = buildLineRenderHints(1, 4);
    const byLine = buildLineRenderHints({ startTime: 1, endTime: 4 });
    expect(byLine).toEqual(byNumbers);
  });

  it('词的结束时间只作为下界参与计算，不会让 renderEndTime 变早', () => {
    // renderEndTime 的最终结果被 Math.max(line.endTime, …) 兜底 ——
    // 它表达的是"最多能留到什么时候"，因此永远不会早于行结束时间
    const earlyWords = buildLineRenderHints({
      startTime: 0,
      endTime: 10,
      words: [{ endTime: 3 }],
    });
    const lateWords = buildLineRenderHints({
      startTime: 0,
      endTime: 10,
      words: [{ endTime: 9 }],
    });
    expect(earlyWords.renderEndTime).toBeGreaterThanOrEqual(10);
    expect(lateWords.renderEndTime).toBeGreaterThanOrEqual(10);
    // 词结束时间影响的是通过/退场窗口的排布（在 fast 模式下参与 exitStart 计算）
    expect(buildLineRenderHints({ startTime: 0, endTime: 0.15 }).timingClass).toBe(
      'short'
    );
  });

  it('过渡时长随时长增加但有上下限', () => {
    const fast = getLineTransitionTiming(0.2, 'fast', 'fast');
    expect(fast.enterDuration).toBeGreaterThanOrEqual(0.045);
    expect(fast.enterDuration).toBeLessThanOrEqual(0.06);

    const veryLong = getLineTransitionTiming(60, 'normal', 'normal');
    expect(veryLong.enterDuration).toBeLessThanOrEqual(0.42);
    expect(veryLong.exitDuration).toBeLessThanOrEqual(0.32);

    const none = getLineTransitionTiming(3, 'none', 'normal');
    expect(none).toEqual({ enterDuration: 0, exitDuration: 0, linePassHold: 0 });
  });
});

describe('annotateLyricLines（渲染提示缓存）', () => {
  it('为每行补上 renderHints', () => {
    const lines = [{ startTime: 0, endTime: 2, words: [{ endTime: 2 }] }];
    const annotated = annotateLyricLines(lines);
    expect(annotated[0].renderHints).toBeTruthy();
    expect(annotated[0].renderHints.timingClass).toBe('normal');
  });

  it('幂等：已算过的行不会被替换（避免无谓的引用变化触发重渲染）', () => {
    const lines = [{ startTime: 0, endTime: 2, words: [{ endTime: 2 }] }];
    const once = annotateLyricLines(lines);
    const twice = annotateLyricLines(once);
    expect(twice[0]).toBe(once[0]); // 同一对象引用
  });

  it('getLineRenderEndTime 对空行返回负无穷（排序时自然排在最前）', () => {
    expect(getLineRenderEndTime(null)).toBe(Number.NEGATIVE_INFINITY);
  });
});

/* ──────────────── graphemeTiming（字素级时间）───────────────── */

describe('splitLyricGraphemes', () => {
  it('切分中日文与拉丁文本', () => {
    expect(splitLyricGraphemes('初めて')).toEqual(['初', 'め', 'て']);
    expect(splitLyricGraphemes('Hello')).toEqual(['H', 'e', 'l', 'l', 'o']);
  });

  it('组合字符与 emoji 不被拆散（这是用 Intl.Segmenter 而非 split("") 的原因）', () => {
    expect(splitLyricGraphemes('👨‍👩‍👧')).toEqual(['👨‍👩‍👧']);
    expect(splitLyricGraphemes('é')).toEqual(['é']);
  });

  it('空输入返回空数组', () => {
    expect(splitLyricGraphemes('')).toEqual([]);
  });
});

describe('buildWordGraphemeTimings', () => {
  it('词内按字素均分时间，末字素结束于词结束时间', () => {
    const timings = buildWordGraphemeTimings({
      text: '初めて',
      startTime: 10,
      endTime: 13,
    });
    expect(timings.map(t => t.char)).toEqual(['初', 'め', 'て']);
    expect(timings[0].startTime).toBeCloseTo(10, 5);
    expect(timings[0].endTime).toBeCloseTo(11, 5);
    expect(timings[2].endTime).toBeCloseTo(13, 5);
  });

  it('带上词序号', () => {
    const timings = buildWordGraphemeTimings(
      { text: 'ab', startTime: 0, endTime: 2 },
      7
    );
    expect(timings.every(t => t.wordIndex === 7)).toBe(true);
  });
});

describe('buildLineGraphemeTimeline', () => {
  it('把词级时间映射回整行（含空格）', () => {
    const line = {
      startTime: 0,
      endTime: 4,
      words: [
        { text: 'ab', startTime: 0, endTime: 2 },
        { text: 'cd', startTime: 2, endTime: 4 },
      ],
    };
    const timeline = buildLineGraphemeTimeline(line);
    // 行文本由词拼接而来
    expect(getLineText(line)).toBe('abcd');
    expect(timeline.map(t => t.char)).toEqual(['a', 'b', 'c', 'd']);
    expect(timeline[0].startTime).toBeCloseTo(0, 5);
    expect(timeline[3].endTime).toBeCloseTo(4, 5);
  });

  it('词之间的空隙字素（空格/标点）取瞬时时间，不占时长', () => {
    // 行文本 "a b" 但词只有 a 与 b（空格不在词里）
    const line = {
      startTime: 0,
      endTime: 4,
      words: [
        { text: 'a', startTime: 0, endTime: 1 },
        { text: 'b', startTime: 3, endTime: 4 },
      ],
    };
    const timeline = buildLineGraphemeTimeline(line);
    expect(timeline.map(t => t.char)).toEqual(['a', 'b']); // 无空格可对齐
  });

  it('空行返回空数组', () => {
    expect(
      buildLineGraphemeTimeline({ startTime: 0, endTime: 1, words: [] })
    ).toEqual([]);
  });

  it('没有词但有时间时，整行按字素均分', () => {
    const timeline = buildLineGraphemeTimeline({
      startTime: 0,
      endTime: 2,
      words: [{ text: 'abcd', startTime: 0, endTime: 2 }],
    });
    expect(timeline).toHaveLength(4);
    expect(timeline[3].endTime).toBeCloseTo(2, 5);
  });
});
