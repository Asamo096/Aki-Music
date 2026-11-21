// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 「逐字歌词」渲染器（V2.1）。
 *
 * 观感：同一句的字逐个"扔"到位，已出现的字保留；最新一个字高亮发光。
 * 与「单句歌词」的区别：
 *   - 整行累积显示，不做前缀裁剪
 *   - 每个字有独立的入场轨迹（随机偏移/角度/缩放 + 回弹）
 *   - 背景保持流体/节拍脉冲，不叠加几何形状
 */
import type { LyricLine } from '@/lyrics/types';
import {
  buildGlyphRow,
  resolveGlyphPose,
  resolveLatestCell,
  type GlyphCell,
  type GlyphRowLayout,
  type GlyphRowLayoutMode,
  type GlyphSecondary,
} from './layout';

export type GlyphQuality = 'high' | 'balanced' | 'low';

export interface GlyphRendererOptions {
  fontFamily: string;
  fontSize: number;
  secondary: GlyphSecondary;
  accent: string;
  theme: 'dark' | 'light';
  quality: GlyphQuality;
  /** 文字锚点（0..1，默认 0.46） */
  anchorRatio?: number;
  /** 透明模式（桌面壁纸层：不画遮罩） */
  transparent?: boolean;
  /** 是否显示下一句预览（桌面默认关闭） */
  showNextPreview?: boolean;
  /** 正文颜色覆盖（桌面歌词自定义颜色） */
  textColor?: string;
  /** 最终排列：line（一条线）/ scatter（随机散落） */
  layout?: GlyphRowLayoutMode;
}

export interface GlyphDrawOptions {
  now: number;
  dt: number;
  level: number;
  reduceMotion: boolean;
  playing: boolean;
}

interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
  time: number;
}

const EXIT_DURATION = 0.5;
const LINE_CENTER_RATIO = 0.46;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export default class GlyphRenderer {
  private canvas: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;

  private options: GlyphRendererOptions;

  private lines: LyricLine[] = [];

  private activeIndex = -1;

  private currentIndex = -2;

  private currentLayout: GlyphRowLayout | null = null;

  private previousLayout: GlyphRowLayout | null = null;

  private previousExitAt = 0;

  private layouts = new Map<number, GlyphRowLayout>();

  private width = 0;

  private height = 0;

  private dpr = 1;

  private hitRects: HitRect[] = [];

  private frames = 0;

  private lastDrawMs = 0;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: GlyphRendererOptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Glyph: 2d context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.options = { ...options };
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  setOptions(patch: Partial<GlyphRendererOptions>): void {
    this.options = { ...this.options, ...patch };
    this.invalidate();
  }

  setData(lines: LyricLine[], activeIndex: number): void {
    const changed = lines !== this.lines;
    this.lines = lines;
    this.activeIndex = activeIndex;
    if (changed) {
      this.invalidate();
      this.currentIndex = -2;
      this.currentLayout = null;
      this.previousLayout = null;
    }
  }

  setActiveIndex(index: number): void {
    this.activeIndex = index;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) {
      return;
    }
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    // 不写 inline width/height：CSS 的 100% 让 canvas 跟随父容器，
    // 否则窗口放大后 canvas 仍停在旧像素尺寸，遮罩层边缘会露出来。
    this.invalidate();
  }

  draw({ now, level, reduceMotion }: GlyphDrawOptions): void {
    if (this.disposed) return;
    const startedAt = performance.now();
    this.syncActiveLine(now);
    const ctx = this.ctx;
    const { width, height } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const dark = this.options.theme !== 'light';
    const baseColor = this.options.textColor || (dark ? '#ffffff' : '#1a1a1c');
    const accent = this.resolveAccent();

    if (!this.options.transparent) this.drawBackdrop(dark);
    this.hitRects = [];

    if (this.previousLayout) {
      this.drawPrevious(now, baseColor);
    }
    if (this.currentLayout) {
      this.drawCurrent(now, level, accent, baseColor, reduceMotion);
    }
    this.drawSubtitle(now, baseColor, accent);

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    this.frames += 1;
    this.lastDrawMs = performance.now() - startedAt;
  }

  getStats(): { frames: number; lastDrawMs: number } {
    return { frames: this.frames, lastDrawMs: this.lastDrawMs };
  }

  hitTest(screenX: number, screenY: number): number | null {
    for (let index = this.hitRects.length - 1; index >= 0; index -= 1) {
      const rect = this.hitRects[index];
      if (
        screenX >= rect.x &&
        screenX <= rect.x + rect.width &&
        screenY >= rect.y &&
        screenY <= rect.y + rect.height
      ) {
        return rect.time;
      }
    }
    return null;
  }

  dispose(): void {
    this.disposed = true;
    this.layouts.clear();
    this.currentLayout = null;
    this.previousLayout = null;
    this.lines = [];
  }

  /* ── 状态 ── */

  private invalidate(): void {
    this.layouts.clear();
  }

  private syncActiveLine(now: number): void {
    if (this.activeIndex === this.currentIndex) return;
    if (this.currentLayout) {
      this.previousLayout = this.currentLayout;
      this.previousExitAt = now;
    }
    this.currentIndex = this.activeIndex;
    this.currentLayout =
      this.activeIndex >= 0 ? this.getLayout(this.activeIndex) : null;
  }

  private font(size: number, weight = 700): string {
    return `${weight} ${size}px ${this.options.fontFamily}`;
  }

  private measureAt(text: string, size: number): number {
    this.ctx.font = this.font(size);
    return this.ctx.measureText(text).width;
  }

  private getLayout(index: number): GlyphRowLayout | null {
    const line = this.lines[index];
    if (!line) return null;
    const cached = this.layouts.get(index);
    if (cached) return cached;
    const maxWidth = Math.min(this.width * 0.84, 1500);
    const baseFont = clamp(this.options.fontSize * 2.4, 48, 116);
    const layout = buildGlyphRow(line, index, {
      maxWidth,
      baseFontSize: baseFont,
      minFontSize: 30,
      secondary: this.options.secondary,
      layout: this.options.layout,
      measure: (text, size) => this.measureAt(text, size),
    });
    this.layouts.set(index, layout);
    return layout;
  }

  private resolveAccent(): string {
    const accent = this.options.accent;
    if (this.options.theme === 'light') return '#2b58d8';
    return accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)
      ? accent
      : '#9fd0ff';
  }

  /* ── 绘制 ── */

  private drawBackdrop(dark: boolean): void {
    const ctx = this.ctx;
    const { width, height } = this;
    ctx.fillStyle = dark ? 'rgba(6,7,11,0.2)' : 'rgba(255,255,255,0.36)';
    ctx.fillRect(0, 0, width, height);

    const centerY = height * (this.options.anchorRatio ?? LINE_CENTER_RATIO);
    const gradient = ctx.createRadialGradient(
      width / 2,
      centerY,
      Math.max(40, width * 0.08),
      width / 2,
      centerY,
      Math.max(width, height) * 0.7
    );
    gradient.addColorStop(
      0,
      dark ? 'rgba(4,5,9,0.42)' : 'rgba(255,255,255,0.5)'
    );
    gradient.addColorStop(
      0.6,
      dark ? 'rgba(4,5,9,0.14)' : 'rgba(255,255,255,0.2)'
    );
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  private drawCell(
    cell: GlyphCell,
    layout: GlyphRowLayout,
    rowStartX: number,
    centerY: number,
    pose: {
      x: number;
      y: number;
      rotation: number;
      scale: number;
      alpha: number;
    },
    color: string,
    glow: number,
    dark: boolean
  ): void {
    if (cell.isSpace) return;
    const ctx = this.ctx;
    const size = Math.max(10, layout.fontSize * pose.scale);
    ctx.save();
    ctx.translate(rowStartX + pose.x + cell.width / 2, centerY + pose.y);
    ctx.rotate(pose.rotation);
    ctx.font = this.font(size);
    ctx.globalAlpha = pose.alpha;
    ctx.fillStyle = color;
    if (dark) {
      ctx.shadowColor = 'rgba(0,0,0,0.42)';
      ctx.shadowBlur = 8;
    }
    if (glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.fillText(cell.char, 0, 0);
    ctx.restore();
  }

  private drawCurrent(
    now: number,
    level: number,
    accent: string,
    baseColor: string,
    reduceMotion: boolean
  ): void {
    const layout = this.currentLayout;
    if (!layout) return;
    const { width, height } = this;
    const rowStartX = (width - layout.width) / 2;
    const centerY = height * (this.options.anchorRatio ?? LINE_CENTER_RATIO);
    const dark = this.options.theme !== 'light';
    const latest = resolveLatestCell(layout, now);

    layout.cells.forEach(cell => {
      let pose = resolveGlyphPose(cell, now);
      if (!pose) return;
      if (reduceMotion) {
        pose = {
          x: cell.x,
          y: cell.y,
          rotation: cell.rotation,
          scale: 1,
          alpha: 1,
          settled: 1,
        };
      }
      const isLatest = latest === cell;
      if (isLatest) {
        // 最新一个字稍微放大/倾斜，像刚落下的那一下
        pose = {
          ...pose,
          scale: pose.scale * 1.07,
          rotation: pose.rotation + 0.05,
        };
      }
      const glow =
        isLatest && this.options.quality !== 'low' ? 12 + level * 26 : 0;
      this.drawCell(
        cell,
        layout,
        rowStartX,
        centerY,
        pose,
        isLatest ? accent : baseColor,
        glow,
        dark
      );
    });

    const lineStart = Number(this.lines[layout.index]?.startTime) || 0;
    this.hitRects.push({
      x: 0,
      y: centerY - layout.fontSize,
      width,
      height: layout.fontSize * 2,
      time: lineStart,
    });
  }

  private drawPrevious(now: number, baseColor: string): void {
    const layout = this.previousLayout;
    if (!layout) return;
    const elapsed = now - this.previousExitAt;
    if (elapsed >= EXIT_DURATION) {
      this.previousLayout = null;
      return;
    }
    const progress = clamp(elapsed / EXIT_DURATION, 0, 1);
    const { width, height } = this;
    const rowStartX = (width - layout.width) / 2;
    const centerY =
      height * (this.options.anchorRatio ?? LINE_CENTER_RATIO) - progress * 18;
    const dark = this.options.theme !== 'light';
    const alpha = (1 - progress) * 0.5;

    layout.cells.forEach(cell => {
      if (cell.isSpace || cell.startTime > this.previousExitAt) return;
      const pose = {
        x: cell.x,
        y: cell.y,
        rotation: cell.rotation,
        scale: 1 - progress * 0.04,
        alpha,
      };
      this.drawCell(cell, layout, rowStartX, centerY, pose, baseColor, 0, dark);
    });
  }

  private drawSubtitle(now: number, baseColor: string, accent: string): void {
    const ctx = this.ctx;
    const { width, height } = this;
    const layout = this.currentLayout;
    const dark = this.options.theme !== 'light';
    if (layout?.translation) {
      const size = Math.max(14, Math.round(layout.fontSize * 0.3));
      ctx.font = this.font(size, 400);
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = baseColor;
      if (dark) {
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 10;
      }
      ctx.fillText(
        layout.translation,
        width / 2,
        height * (this.options.anchorRatio ?? LINE_CENTER_RATIO) +
          layout.fontSize * (this.options.layout === 'scatter' ? 1.55 : 1.15)
      );
      ctx.shadowBlur = 0;
    }

    const nextIndex =
      this.activeIndex >= 0 ? this.activeIndex + 1 : this.findNextIndex(now);
    const next =
      this.options.showNextPreview === false ? null : this.lines[nextIndex];
    if (next) {
      const text = (next.words || []).map(word => word.text).join('');
      if (text) {
        const size = Math.max(13, Math.round((layout?.fontSize ?? 48) * 0.3));
        ctx.font = this.font(size, 500);
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = accent;
        if (dark) {
          ctx.shadowColor = 'rgba(0,0,0,0.3)';
          ctx.shadowBlur = 8;
        }
        const y = height * 0.86;
        ctx.fillText(text, width / 2, y);
        ctx.shadowBlur = 0;
        const textWidth = ctx.measureText(text).width;
        this.hitRects.push({
          x: width / 2 - textWidth / 2 - 16,
          y: y - size,
          width: textWidth + 32,
          height: size * 2,
          time: Number(next.startTime) || 0,
        });
      }
    }
    ctx.globalAlpha = 1;
  }

  private findNextIndex(now: number): number {
    for (let index = 0; index < this.lines.length; index += 1) {
      if ((Number(this.lines[index].startTime) || 0) > now - 0.03) {
        return index;
      }
    }
    return Math.max(0, this.lines.length - 1);
  }
}
