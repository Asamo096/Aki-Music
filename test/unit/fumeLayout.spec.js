import { describe, expect, it } from 'vitest';
import {
  buildFumeOverview,
  buildGlyphTimings,
  fitFontSize,
  layoutFumeLine,
  resolveCurrentGlyph,
  resolveRevealedCount,
  wrapChars,
} from '../../src/visual/fume/layout';

const measure = text => text.length * 10;
const line = (text, start, end, extra = {}) => ({
  words: [{ text, startTime: start, endTime: end }],
  startTime: start,
  endTime: end,
  ...extra,
});

describe('fume layout (cinematic)', () => {
  it('自动缩放有下限，超长句交给换行兜底', () => {
    expect(
      fitFontSize('短句', {
        baseFontSize: 60,
        minFontSize: 30,
        maxWidth: 200,
        measure,
      })
    ).toBe(60);
    expect(
      fitFontSize('非常非常非常非常非常非常长的句子', {
        baseFontSize: 60,
        minFontSize: 30,
        maxWidth: 50,
        measure,
      })
    ).toBe(30);
    const rows = wrapChars(['一', '二', '三', '四', '五'], 20, measure);
    expect(rows).toEqual([['一', '二'], ['三', '四'], ['五']]);
  });

  it('逐字时间：词内按字符均分', () => {
    const lyricLine = {
      words: [
        { text: 'ab', startTime: 0, endTime: 2 },
        { text: 'c', startTime: 2, endTime: 3 },
      ],
      startTime: 0,
      endTime: 3,
    };
    const glyphs = buildGlyphTimings(lyricLine, ['a', 'b', 'c']);
    expect(glyphs.map(g => g.startTime)).toEqual([0, 1, 2]);
    expect(glyphs[2].wordIndex).toBe(1);
  });

  it('行级歌词按整行线性分摊', () => {
    const glyphs = buildGlyphTimings(line('abcd', 0, 4), ['a', 'b', 'c', 'd']);
    expect(glyphs.map(g => g.startTime)).toEqual([0, 1, 2, 3]);
  });

  it('当前行排版：字号、行高、翻译', () => {
    const layout = layoutFumeLine(
      line('今天天气不错', 0, 4, { translation: 'nice weather' }),
      0,
      {
        maxWidth: 1000,
        baseFontSize: 56,
        minFontSize: 28,
        measure,
        secondary: 'translation',
      }
    );
    expect(layout.fontSize).toBe(56);
    expect(layout.rows).toHaveLength(1);
    expect(layout.translation).toBe('nice weather');
    expect(layout.height).toBeGreaterThan(0);
  });

  it('超长句会换行成多行', () => {
    const layout = layoutFumeLine(line('一二三四五六七八九十', 0, 4), 0, {
      maxWidth: 30,
      baseFontSize: 30,
      minFontSize: 30,
      measure,
    });
    expect(layout.rows.length).toBeGreaterThan(1);
  });

  it('overview 取下一句开始的 5 句并标注层次', () => {
    const lines = Array.from({ length: 8 }, (_, index) =>
      line(`第${index}句`, index, index + 1)
    );
    const overview = buildFumeOverview(lines, 3, {
      fontSize: 24,
      lineHeight: 36,
    });
    expect(overview.entries).toHaveLength(5);
    expect(overview.entries[0]).toMatchObject({ index: 3, tone: 'current' });
    expect(overview.entries[3].tone).toBe('far');
  });

  it('已揭示字形按时间前缀计数', () => {
    const lyricLine = {
      words: [
        { text: 'ab', startTime: 0, endTime: 2 },
        { text: 'c', startTime: 2, endTime: 3 },
      ],
      startTime: 0,
      endTime: 3,
    };
    const layout = layoutFumeLine(lyricLine, 0, {
      maxWidth: 1000,
      baseFontSize: 40,
      minFontSize: 40,
      measure,
    });
    const row = layout.rows[0];
    expect(resolveRevealedCount(row, 0)).toBe(1);
    expect(resolveRevealedCount(row, 2)).toBe(3);
    expect(resolveCurrentGlyph(row, 0)?.char).toBe('a');
    expect(resolveCurrentGlyph(row, 0.5)?.char).toBe('a');
  });
});
