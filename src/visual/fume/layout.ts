// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fume 模式的文本排版（纯函数，便于单测）。
 *
 * 这一层只负责“把每一行歌词排成可绘制的块 + 相机目标 + 命中测试”，
 * 不接触 Canvas/DOM：字体测量由调用方注入 `measure(text) => width`。
 *
 * 与 Folia 的 fume 相比这是简化版：不做 article-level 布局与静态快照，
 * 只保留“竖向歌词流 + 当前行居中 + 逐字打印”的观感。
 */
import type { LyricLine } from '@/lyrics/types';
import { getLineSecondaryText } from '@/lyrics/utils/text';

/** 副行类型（none 表示不显示翻译/音译） */
export type FumeSecondary = 'translation' | 'romaPronunciation' | 'none';

export interface FumeMeasure {
  (text: string): number;
}

export interface FumeLayoutOptions {
  width: number;
  height: number;
  fontSize: number;
  measure: FumeMeasure;
  /** 副行来源：translation | romaPronunciation | none */
  secondary?: FumeSecondary;
}

export interface FumeLineBox {
  index: number;
  line: LyricLine;
  /** 换行后的文本片段（每段一行） */
  segments: string[];
  translation: string | null;
  /** 块顶部（世界坐标，向下为正） */
  y: number;
  height: number;
  textHeight: number;
}

export interface FumeLayout {
  boxes: FumeLineBox[];
  /** 歌词流总高度 */
  totalHeight: number;
  /** 文本列宽度 */
  columnWidth: number;
  /** 文本列左边距 */
  columnX: number;
  lineHeight: number;
  segmentHeight: number;
  translationHeight: number;
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

/**
 * 按宽度换行：CJK 可任意断行，拉丁词优先在空格处断；超长单词强制断。
 */
export const wrapText = (
  text: string,
  maxWidth: number,
  measure: FumeMeasure
): string[] => {
  const source = String(text ?? '').replace(/\r/g, '');
  if (!source.trim()) return [''];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [source];

  const segments: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current) segments.push(current);
    current = '';
  };

  for (const char of Array.from(source)) {
    if (char === '\n') {
      pushCurrent();
      continue;
    }
    const candidate = current + char;
    if (!current || measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    // 放不下：拉丁词尽量退到最近的空格；CJK 直接断在字符前
    const lastSpace = isWideChar(char) ? -1 : current.lastIndexOf(' ');
    if (lastSpace > 0 && lastSpace > current.length * 0.4) {
      segments.push(current.slice(0, lastSpace));
      current = current.slice(lastSpace + 1) + char;
    } else {
      segments.push(current);
      current = char === ' ' ? '' : char;
    }
  }
  pushCurrent();
  return segments.length ? segments : [''];
};

/**
 * 排版整个歌词流。
 * 行距与翻译高度按字号推导，保证不同字号下观感一致。
 */
export const layoutFumeLines = (
  lines: LyricLine[],
  options: FumeLayoutOptions
): FumeLayout => {
  const fontSize = Math.max(12, Number(options.fontSize) || 28);
  const segmentHeight = fontSize * 1.32;
  const translationHeight = fontSize * 0.62 * 1.3;
  const lineHeight = segmentHeight + fontSize * 0.55;
  const columnWidth = Math.max(220, Math.min(options.width * 0.72, 980));
  const columnX = (options.width - columnWidth) / 2;
  const secondary = options.secondary ?? 'translation';

  const boxes: FumeLineBox[] = [];
  let cursorY = 0;
  lines.forEach((line, index) => {
    const text = (line.words || []).map(word => word.text).join('');
    const segments = wrapText(text, columnWidth, options.measure);
    const translation =
      secondary === 'none'
        ? null
        : getLineSecondaryText(line, secondary) || null;
    const textHeight = Math.max(1, segments.length) * segmentHeight;
    const height = textHeight + (translation ? translationHeight : 0);
    boxes.push({
      index,
      line,
      segments,
      translation,
      y: cursorY,
      height,
      textHeight,
    });
    cursorY += height + lineHeight - segmentHeight;
  });

  const totalHeight = boxes.length ? cursorY : 0;
  return {
    boxes,
    totalHeight,
    columnWidth,
    columnX,
    lineHeight,
    segmentHeight,
    translationHeight,
  };
};

/** 相机偏移：让当前行块的中心落在视口中心 */
export const resolveCameraTarget = (
  layout: FumeLayout,
  activeIndex: number,
  viewportHeight: number
): number => {
  if (!layout.boxes.length) return 0;
  const index = Math.min(Math.max(activeIndex, 0), layout.boxes.length - 1);
  const box = layout.boxes[index];
  return viewportHeight / 2 - (box.y + box.height / 2);
};

/** 把屏幕坐标反查成歌词行（用于点击 seek）；命中不到返回 null */
export const hitTestLine = (
  layout: FumeLayout,
  cameraY: number,
  screenY: number
): FumeLineBox | null => {
  const worldY = screenY - cameraY;
  let low = 0;
  let high = layout.boxes.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const box = layout.boxes[mid];
    if (worldY < box.y) {
      high = mid - 1;
    } else if (worldY > box.y + box.height) {
      low = mid + 1;
    } else {
      return box;
    }
  }
  return null;
};

/**
 * 当前行每个片段的“揭示进度”（0..1）。
 *
 * 优先用逐字时间：把词的起止时间分摊到字符上，取片段内已揭示字符比例；
 * 没有逐字时间时退化为整行线性进度。
 */
export const resolveSegmentProgress = (
  line: LyricLine,
  segments: string[],
  now: number
): number[] => {
  const totalChars = segments.reduce((sum, text) => sum + text.length, 0);
  if (!totalChars) return segments.map(() => 0);
  const lineStart = Number(line.startTime) || 0;
  const lineEnd = Number(line.endTime) || lineStart;
  const duration = Math.max(0.001, lineEnd - lineStart);
  const lineProgress = Math.min(1, Math.max(0, (now - lineStart) / duration));

  const words = (line.words || []).filter(word => word.text);
  // 行级歌词（只有一个“词”）按整行线性进度，不要假装逐字
  if (words.length <= 1) return segments.map(() => lineProgress);

  let charCursor = 0;
  const revealed = new Array(totalChars).fill(false);
  for (const word of words) {
    const chars = Array.from(word.text);
    const start = Number(word.startTime) || lineStart;
    const end = Math.max(start, Number(word.endTime) || start);
    const span = Math.max(0.001, end - start);
    chars.forEach((_, offset) => {
      const at = start + (span * offset) / Math.max(1, chars.length);
      if (charCursor + offset < totalChars) {
        revealed[charCursor + offset] = now >= at;
      }
    });
    charCursor += chars.length;
  }

  let offset = 0;
  return segments.map(text => {
    const length = text.length;
    if (!length) return 0;
    let count = 0;
    for (let index = offset; index < offset + length; index += 1) {
      if (revealed[index]) count += 1;
    }
    offset += length;
    return count / length;
  });
};
