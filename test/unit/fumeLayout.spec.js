import { describe, expect, it } from 'vitest';
import {
  hitTestLine,
  layoutFumeLines,
  resolveCameraTarget,
  resolveSegmentProgress,
  wrapText,
} from '../../src/visual/fume/layout';

const measure = text => text.length * 10;
const line = (text, start, end, extra = {}) => ({
  words: [{ text, startTime: start, endTime: end }],
  startTime: start,
  endTime: end,
  ...extra,
});

describe('fume layout', () => {
  it('CJK 按宽度断行', () => {
    const segments = wrapText('一二三四五六七八九十', 50, measure);
    expect(segments).toEqual(['一二三四五', '六七八九十']);
  });

  it('拉丁词优先在空格处断行', () => {
    const segments = wrapText('hello world foo', 100, measure);
    expect(segments).toEqual(['hello', 'world foo']);
    expect(segments.join(' ')).toBe('hello world foo');
  });

  it('排版产生正确的块高度与翻译行', () => {
    const layout = layoutFumeLines(
      [
        line('第一行', 0, 2),
        line('第二行', 2, 4, { translation: 'second line' }),
        line('第三行', 4, 6),
      ],
      {
        width: 800,
        height: 600,
        fontSize: 20,
        measure,
        secondary: 'translation',
      }
    );
    expect(layout.boxes).toHaveLength(3);
    expect(layout.boxes[1].height).toBeGreaterThan(layout.boxes[0].height);
    expect(layout.boxes[2].y).toBeGreaterThan(layout.boxes[1].y);
    expect(layout.totalHeight).toBeGreaterThan(0);
  });

  it('相机目标把当前行放到视口中心', () => {
    const layout = layoutFumeLines(
      [line('a', 0, 1), line('b', 1, 2), line('c', 2, 3)],
      { width: 800, height: 600, fontSize: 20, measure }
    );
    const box = layout.boxes[1];
    const target = resolveCameraTarget(layout, 1, 600);
    expect(box.y + box.height / 2 + target).toBeCloseTo(300, 5);
  });

  it('命中测试按世界坐标找到行', () => {
    const layout = layoutFumeLines([line('a', 0, 1), line('b', 5, 6)], {
      width: 800,
      height: 600,
      fontSize: 20,
      measure,
    });
    const second = layout.boxes[1];
    const cameraY = 0;
    const hit = hitTestLine(layout, cameraY, second.y + 1);
    expect(hit?.line.startTime).toBe(5);
    expect(hitTestLine(layout, cameraY, -1000)).toBeNull();
  });

  it('逐字进度按字符时间分摊', () => {
    const lyricLine = {
      words: [
        { text: 'ab', startTime: 0, endTime: 5 },
        { text: 'cd', startTime: 5, endTime: 10 },
      ],
      startTime: 0,
      endTime: 10,
    };
    const atStart = resolveSegmentProgress(lyricLine, ['abcd'], 0);
    const midway = resolveSegmentProgress(lyricLine, ['abcd'], 4);
    const atEnd = resolveSegmentProgress(lyricLine, ['abcd'], 10);
    expect(atStart[0]).toBe(0.25);
    expect(midway[0]).toBeCloseTo(0.5, 5);
    expect(atEnd[0]).toBe(1);
  });

  it('行级歌词退化为线性进度', () => {
    const lyricLine = line('整行歌词', 0, 10);
    expect(resolveSegmentProgress(lyricLine, ['整行歌词'], 5)[0]).toBeCloseTo(
      0.5,
      5
    );
  });
});
