import { describe, expect, it } from 'vitest';
import {
  buildGlyphRow,
  easeOutBack,
  fitGlyphFontSize,
  hashSeed,
  resolveGlyphPose,
  resolveLatestCell,
} from '../../src/visual/glyph/layout';

const measure = (text, size) => text.length * size;
const line = (text, start, end, extra = {}) => ({
  words: [{ text, startTime: start, endTime: end }],
  startTime: start,
  endTime: end,
  ...extra,
});

describe('glyph layout', () => {
  it('自动缩放把整行放进最大宽度', () => {
    const size = fitGlyphFontSize('一二三四五六七八九十', {
      baseFontSize: 80,
      minFontSize: 30,
      maxWidth: 500,
      measure,
    });
    expect(size).toBeLessThan(80);
    expect(size).toBeGreaterThanOrEqual(30);
  });

  it('短句会拉开字距并居中所需宽度', () => {
    const row = buildGlyphRow(line('眼神中飘移', 0, 4), 0, {
      maxWidth: 1200,
      baseFontSize: 80,
      minFontSize: 30,
      measure,
    });
    expect(row.cells).toHaveLength(5);
    expect(row.spacing).toBeGreaterThan(row.fontSize * 0.16);
    expect(row.width).toBeGreaterThan(row.fontSize * 4);
    expect(row.cells[4].x).toBeGreaterThan(row.cells[0].x);
  });

  it('逐字时间来自词时间分摊', () => {
    const row = buildGlyphRow(
      {
        words: [
          { text: 'ab', startTime: 0, endTime: 2 },
          { text: 'c', startTime: 2, endTime: 4 },
        ],
        startTime: 0,
        endTime: 4,
      },
      0,
      { maxWidth: 1000, baseFontSize: 60, minFontSize: 30, measure }
    );
    expect(row.cells.map(cell => cell.startTime)).toEqual([0, 1, 2]);
  });

  it('每个字的入场姿态可复现（种子确定性）', () => {
    const rowA = buildGlyphRow(line('浮出效果', 1, 3), 0, {
      maxWidth: 1000,
      baseFontSize: 60,
      minFontSize: 30,
      measure,
    });
    const rowB = buildGlyphRow(line('浮出效果', 1, 3), 0, {
      maxWidth: 1000,
      baseFontSize: 60,
      minFontSize: 30,
      measure,
    });
    expect(rowA.cells.map(cell => cell.fromX)).toEqual(
      rowB.cells.map(cell => cell.fromX)
    );
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
  });

  it('出现前不可见，落位后回到最终位置', () => {
    const row = buildGlyphRow(line('浮出', 0, 2), 0, {
      maxWidth: 800,
      baseFontSize: 60,
      minFontSize: 30,
      measure,
    });
    const cell = row.cells[0];
    expect(resolveGlyphPose(cell, cell.startTime - 0.1)).toBeNull();
    const settled = resolveGlyphPose(cell, cell.startTime + 1);
    expect(settled).not.toBeNull();
    expect(settled.x).toBeCloseTo(cell.x, 5);
    expect(settled.y).toBeCloseTo(cell.y, 5);
    expect(settled.scale).toBeCloseTo(1, 2);
    expect(settled.alpha).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0, 5);
    expect(easeOutBack(1)).toBeCloseTo(1, 5);
  });

  it('最新的非空格字符会被高亮', () => {
    const row = buildGlyphRow(line('ab', 0, 1), 0, {
      maxWidth: 800,
      baseFontSize: 60,
      minFontSize: 30,
      measure,
    });
    expect(resolveLatestCell(row, -1)).toBeNull();
    expect(resolveLatestCell(row, 0.2)?.char).toBe('a');
    expect(resolveLatestCell(row, 1)?.char).toBe('b');
  });
});
