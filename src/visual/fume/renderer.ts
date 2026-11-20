// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fume 渲染器（V2 设计版：单句电影感）。
 *
 * 用户确认的四个方向：
 *   1. 单句电影感（超大字、当前句居中、自动缩放）
 *   2. 字形级打印（逐字出现 + 笔尖光点）
 *   3. 几何/微尘背景（ring/square/cross + 漂浮颗粒，接节拍）
 *   4. 聚焦 + 间奏 overview（间奏展示后续 5 句，回到播放时推近当前句）
 *
 * 仍是单个 Canvas 2D；Folia 的实测结论是 Pixi 版本并不更省显存。
 * 只画视觉层，不解析歌词、不读 store、不管理播放。
 */
import type { LyricLine } from '@/lyrics/types';
import {
  buildFumeOverview,
  layoutFumeLine,
  resolveCurrentGlyph,
  resolveRevealedCount,
  type FumeLineLayout,
  type FumeOverviewLayout,
  type FumeSecondary,
} from './layout';

export type FumeQuality = 'high' | 'balanced' | 'low';

export interface FumeRendererOptions {
  fontFamily: string;
  /** 设置里的歌词字号（当前句会在此基础上放大） */
  fontSize: number;
  secondary: FumeSecondary;
  accent: string;
  theme: 'dark' | 'light';
  quality: FumeQuality;
}

export interface FumeDrawOptions {
  now: number;
  dt: number;
  level: number;
  reduceMotion: boolean;
  playing: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
  time: number;
}

interface ShapeSpec {
  type: 'ring' | 'square' | 'cross';
  x: number;
  y: number;
  size: number;
  rotation: number;
  speed: number;
  phase: number;
}

const PARTICLE_LIMIT: Record<FumeQuality, number> = {
  high: 64,
  balanced: 36,
  low: 0,
};

const ACTIVE_FONT_RATIO = 2.0;
const ACTIVE_FONT_MIN = 44;
const ACTIVE_FONT_MAX = 92;
const OVERVIEW_FONT_RATIO = 0.92;
const LINE_CENTER_RATIO = 0.46;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const SHAPES: ShapeSpec[] = [
  {
    type: 'ring',
    x: 0.13,
    y: 0.22,
    size: 128,
    rotation: 0.2,
    speed: 0.05,
    phase: 0.4,
  },
  {
    type: 'square',
    x: 0.86,
    y: 0.26,
    size: 86,
    rotation: 0.6,
    speed: -0.04,
    phase: 1.2,
  },
  {
    type: 'cross',
    x: 0.2,
    y: 0.78,
    size: 64,
    rotation: 0.1,
    speed: 0.03,
    phase: 2.1,
  },
  {
    type: 'ring',
    x: 0.8,
    y: 0.74,
    size: 168,
    rotation: 0.9,
    speed: -0.03,
    phase: 0.9,
  },
  {
    type: 'square',
    x: 0.5,
    y: 0.12,
    size: 56,
    rotation: 0.45,
    speed: 0.06,
    phase: 2.7,
  },
  {
    type: 'ring',
    x: 0.68,
    y: 0.46,
    size: 44,
    rotation: 0.3,
    speed: 0.08,
    phase: 1.8,
  },
  {
    type: 'cross',
    x: 0.1,
    y: 0.52,
    size: 48,
    rotation: 0.2,
    speed: -0.05,
    phase: 3.2,
  },
  {
    type: 'square',
    x: 0.9,
    y: 0.56,
    size: 40,
    rotation: 0.75,
    speed: 0.05,
    phase: 0.2,
  },
];

export default class FumeRenderer {
  private canvas: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;

  private options: FumeRendererOptions;

  private lines: LyricLine[] = [];

  private activeIndex = -1;

  /** 最近一个有效行：间奏淡出时仍画这一句，避免跳到第 0 句 */
  private focusIndex = 0;

  private width = 0;

  private height = 0;

  private dpr = 1;

  private focusAmount = 0;

  private layouts = new Map<number, FumeLineLayout>();

  private overviewLayout: FumeOverviewLayout | null = null;

  private overviewKey = '';

  private particles: Particle[] = [];

  private spawnCarry = 0;

  private hitRects: HitRect[] = [];

  private frames = 0;

  private lastDrawMs = 0;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: FumeRendererOptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Fume: 2d context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.options = { ...options };
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  setOptions(patch: Partial<FumeRendererOptions>): void {
    this.options = { ...this.options, ...patch };
    this.invalidateLayouts();
  }

  setData(lines: LyricLine[], activeIndex: number): void {
    const changed = lines !== this.lines;
    this.lines = lines;
    this.activeIndex = activeIndex;
    if (activeIndex >= 0) this.focusIndex = activeIndex;
    if (changed) this.invalidateLayouts();
  }

  setActiveIndex(index: number): void {
    this.activeIndex = index;
    if (index >= 0) this.focusIndex = index;
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
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.invalidateLayouts();
  }

  draw({ now, dt, level, reduceMotion, playing }: FumeDrawOptions): void {
    if (this.disposed) return;
    const startedAt = performance.now();
    const ctx = this.ctx;
    const { width, height } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const dark = this.options.theme !== 'light';
    const baseColor = dark ? '255,255,255' : '28,28,30';
    const accent = this.resolveAccent();
    const focusTarget = this.activeIndex >= 0 && this.lines.length ? 1 : 0;
    if (reduceMotion) {
      this.focusAmount = focusTarget;
    } else {
      const alpha = 1 - Math.exp(-Math.max(0, dt) * 5);
      this.focusAmount += (focusTarget - this.focusAmount) * alpha;
    }
    if (this.focusAmount < 0.001) this.focusAmount = 0;
    if (this.focusAmount > 0.999) this.focusAmount = 1;

    this.drawBackground({ now, level, dark, accent, baseColor });
    this.drawShapes({ now, level, accent });
    this.drawParticles({ dt, level, playing, reduceMotion, accent });

    this.hitRects = [];
    if (focusTarget || this.focusAmount > 0) {
      this.drawFocusLine(now, level, accent, baseColor, dark);
    }
    if (this.focusAmount < 1) {
      this.drawOverview(now, this.focusAmount, accent, baseColor, dark);
    }
    this.drawEdgeFade();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    this.frames += 1;
    this.lastDrawMs = performance.now() - startedAt;
  }

  /** 验收用 */
  getStats(): { frames: number; lastDrawMs: number; particles: number } {
    return {
      frames: this.frames,
      lastDrawMs: this.lastDrawMs,
      particles: this.particles.length,
    };
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
    this.particles = [];
    this.layouts.clear();
    this.overviewLayout = null;
    this.lines = [];
  }

  /* ── 布局 ── */

  private invalidateLayouts(): void {
    this.layouts.clear();
    this.overviewLayout = null;
    this.overviewKey = '';
  }

  private font(size: number, weight = 600): string {
    return `${weight} ${size}px ${this.options.fontFamily}`;
  }

  private measureAt(text: string, size: number): number {
    this.ctx.font = this.font(size);
    return this.ctx.measureText(text).width;
  }

  private getLayout(index: number): FumeLineLayout | null {
    const line = this.lines[index];
    if (!line) return null;
    const cached = this.layouts.get(index);
    if (cached) return cached;

    const maxWidth = Math.min(this.width * 0.86, 1280);
    const text = (line.words || []).map(word => word.text).join('');
    const base = clamp(
      this.options.fontSize * ACTIVE_FONT_RATIO,
      ACTIVE_FONT_MIN,
      ACTIVE_FONT_MAX
    );
    const min = Math.max(28, Math.round(base * 0.45));
    let size = base;
    while (size > min && this.measureAt(text, size) > maxWidth) size -= 2;

    this.ctx.font = this.font(size);
    const layout = layoutFumeLine(line, index, {
      maxWidth,
      baseFontSize: size,
      minFontSize: size,
      secondary: this.options.secondary,
      measure: candidate => this.measureAt(candidate, size),
    });
    this.layouts.set(index, layout);
    return layout;
  }

  private getOverview(now: number): FumeOverviewLayout | null {
    if (!this.lines.length) return null;
    const nextIndex = this.findNextIndex(now);
    const key = `${nextIndex}`;
    if (this.overviewLayout && this.overviewKey === key) {
      return this.overviewLayout;
    }
    const fontSize = clamp(this.options.fontSize * OVERVIEW_FONT_RATIO, 22, 42);
    this.overviewLayout = buildFumeOverview(this.lines, nextIndex, {
      fontSize,
      lineHeight: Math.round(fontSize * 1.5),
    });
    this.overviewKey = key;
    return this.overviewLayout;
  }

  private findNextIndex(now: number): number {
    for (let index = 0; index < this.lines.length; index += 1) {
      if ((Number(this.lines[index].startTime) || 0) > now - 0.03) {
        return index;
      }
    }
    return Math.max(0, this.lines.length - 1);
  }

  /* ── 绘制 ── */

  private drawBackground({
    now,
    level,
    dark,
    accent,
    baseColor,
  }: {
    now: number;
    level: number;
    dark: boolean;
    accent: string;
    baseColor: string;
  }): void {
    const ctx = this.ctx;
    const { width, height } = this;
    ctx.fillStyle = dark ? 'rgba(8,9,14,0.42)' : 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, 0, width, height);

    // 文字区的径向底色：让超大字在任何背景上都能读清
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * LINE_CENTER_RATIO,
      Math.max(40, width * 0.08),
      width * 0.5,
      height * LINE_CENTER_RATIO,
      Math.max(width, height) * 0.7
    );
    const scrim = dark ? 'rgba(4,5,9,0.5)' : 'rgba(255,255,255,0.55)';
    gradient.addColorStop(0, scrim);
    gradient.addColorStop(
      0.55,
      dark ? 'rgba(4,5,9,0.18)' : 'rgba(255,255,255,0.24)'
    );
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    void now;
    void level;
    void accent;
    void baseColor;
  }

  private drawShapes({
    now,
    level,
    accent,
  }: {
    now: number;
    level: number;
    accent: string;
  }): void {
    const ctx = this.ctx;
    const { width, height } = this;
    const focusScale = 0.9 + this.focusAmount * 0.1;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    SHAPES.forEach(shape => {
      const pulse =
        1 +
        level *
          0.08 *
          Math.sin(now * 0.9 + shape.phase) *
          (0.5 + this.focusAmount * 0.5);
      const size = shape.size * focusScale * pulse;
      const rotation = shape.rotation + now * shape.speed;
      const x = shape.x * width;
      const y = shape.y * height;
      ctx.globalAlpha = 0.05 + level * 0.05 + this.focusAmount * 0.02;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      if (shape.type === 'ring') {
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape.type === 'square') {
        ctx.strokeRect(-size / 2, -size / 2, size, size);
      } else {
        ctx.beginPath();
        ctx.moveTo(-size / 2, 0);
        ctx.lineTo(size / 2, 0);
        ctx.moveTo(0, -size / 2);
        ctx.lineTo(0, size / 2);
        ctx.stroke();
      }
      ctx.restore();
    });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawParticles({
    dt,
    level,
    playing,
    reduceMotion,
    accent,
  }: {
    dt: number;
    level: number;
    playing: boolean;
    reduceMotion: boolean;
    accent: string;
  }): void {
    const limit = PARTICLE_LIMIT[this.options.quality];
    if (!limit || reduceMotion) {
      this.particles = [];
      return;
    }
    if (playing && level > 0.03) {
      this.spawnCarry += dt * (8 + level * 22);
      while (this.spawnCarry >= 1) {
        this.spawnCarry -= 1;
        if (this.particles.length >= limit) break;
        const life = 1.6 + Math.random() * 2.4;
        const centerY = this.height * LINE_CENTER_RATIO;
        this.particles.push({
          x: this.width * (0.18 + Math.random() * 0.64),
          y: centerY + (Math.random() - 0.5) * this.height * 0.3,
          vx: (Math.random() - 0.5) * 14,
          vy: -10 - Math.random() * 30,
          life,
          maxLife: life,
          size: 0.8 + Math.random() * 2.2,
        });
      }
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = accent;
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
      if (particle.life <= 0) continue;
      const ratio = particle.life / particle.maxLife;
      ctx.globalAlpha = clamp(ratio * ratio * 0.3 * (0.35 + level), 0, 0.5);
      ctx.beginPath();
      ctx.arc(
        particle.x,
        particle.y,
        particle.size * (0.6 + ratio * 0.7),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter(particle => particle.life > 0);
  }

  private drawFocusLine(
    now: number,
    level: number,
    accent: string,
    baseColor: string,
    dark: boolean
  ): void {
    const index = this.activeIndex >= 0 ? this.activeIndex : this.focusIndex;
    const layout = this.getLayout(index);
    if (!layout) return;
    const ctx = this.ctx;
    const { width, height } = this;
    const focus = this.focusAmount;
    if (focus <= 0.001) return;

    // 间奏时保留上一条有效行，避免“突然空屏”
    const lineStart = Number(this.lines[index]?.startTime) || 0;
    const lineEnd = Number(this.lines[index]?.endTime) || lineStart;

    const centerY = height * LINE_CENTER_RATIO;
    const scale = 0.96 + focus * 0.04;
    const top = centerY - layout.height / 2;
    const textAlpha = focus;

    ctx.save();
    ctx.translate(width / 2, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -centerY);

    layout.rows.forEach((row, rowIndex) => {
      if (!row.text) return;
      const rowY = top + rowIndex * layout.lineHeight;
      const rowX = (width - row.width) / 2;
      ctx.font = this.font(layout.fontSize);
      ctx.textAlign = 'left';

      // 未揭示：低亮底字
      ctx.globalAlpha = 0.16 * textAlpha;
      ctx.fillStyle = `rgb(${baseColor})`;
      ctx.fillText(row.text, rowX, rowY + layout.lineHeight / 2);

      const revealed = resolveRevealedCount(row, now);
      if (revealed > 0) {
        const prefix = row.glyphs
          .slice(0, revealed)
          .map(glyph => glyph.char)
          .join('');
        ctx.globalAlpha = 0.96 * textAlpha;
        ctx.fillStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = this.options.quality === 'low' ? 0 : 12 + level * 36;
        ctx.fillText(prefix, rowX, rowY + layout.lineHeight / 2);
        ctx.shadowBlur = 0;

        // 笔尖光点：跟随当前正在打印的字
        const current = resolveCurrentGlyph(row, now);
        if (current && !current.isSpace) {
          const prefixWidth = ctx.measureText(prefix).width;
          const dotX = rowX + prefixWidth;
          const dotY = rowY + layout.lineHeight / 2;
          const radius = 1.6 + level * 3.2;
          ctx.globalAlpha = (0.55 + level * 0.45) * textAlpha;
          ctx.beginPath();
          ctx.arc(dotX + 3, dotY, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      this.hitRects.push({
        x: rowX,
        y: rowY,
        width: Math.max(row.width, 40),
        height: layout.lineHeight,
        time: lineStart,
      });
    });

    // 翻译
    if (layout.translation) {
      const fontSize = Math.max(15, Math.round(layout.fontSize * 0.4));
      ctx.font = this.font(fontSize, 400);
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.68 * textAlpha;
      ctx.fillStyle = `rgb(${baseColor})`;
      ctx.fillText(
        layout.translation,
        width / 2,
        top + layout.height + fontSize * 1.15
      );
    }

    // 下一句预览
    const next =
      this.lines[
        (this.activeIndex >= 0 ? this.activeIndex : this.focusIndex) + 1
      ];
    if (next) {
      const nextText = (next.words || []).map(word => word.text).join('');
      if (nextText) {
        const fontSize = Math.max(14, Math.round(layout.fontSize * 0.38));
        ctx.font = this.font(fontSize, 500);
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.3 * textAlpha;
        ctx.fillStyle = `rgb(${baseColor})`;
        const previewY =
          top +
          layout.height +
          (layout.translation ? fontSize * 2.4 : fontSize * 1.6);
        ctx.fillText(nextText, width / 2, previewY);
        this.hitRects.push({
          x: width / 2 - ctx.measureText(nextText).width / 2,
          y: previewY - fontSize,
          width: ctx.measureText(nextText).width,
          height: fontSize * 2,
          time: Number(next.startTime) || 0,
        });
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    void lineEnd;
    void dark;
  }

  private drawOverview(
    now: number,
    focus: number,
    accent: string,
    baseColor: string,
    dark: boolean
  ): void {
    const overview = this.getOverview(now);
    if (!overview || !overview.entries.length) return;
    const ctx = this.ctx;
    const { width, height } = this;
    const visible = 1 - focus;
    const centerY = height * LINE_CENTER_RATIO;
    const totalHeight =
      overview.entries.length * overview.lineHeight -
      (overview.lineHeight - overview.fontSize * 0.8);
    let y = centerY - totalHeight / 2 + overview.lineHeight / 2;

    ctx.textAlign = 'center';
    overview.entries.forEach(entry => {
      const isCurrent = entry.tone === 'current';
      const isNear = entry.tone === 'near';
      const fontSize = isCurrent
        ? overview.fontSize * 1.18
        : isNear
        ? overview.fontSize
        : overview.fontSize * 0.88;
      ctx.font = this.font(fontSize, isCurrent ? 600 : 500);
      ctx.fillStyle = isCurrent ? accent : `rgb(${baseColor})`;
      ctx.globalAlpha = (isCurrent ? 0.82 : isNear ? 0.42 : 0.24) * visible;
      if (isCurrent && this.options.quality !== 'low') {
        ctx.shadowColor = accent;
        ctx.shadowBlur = 16;
      }
      ctx.fillText(entry.text, width / 2, y);
      ctx.shadowBlur = 0;
      this.hitRects.push({
        x: width / 2 - ctx.measureText(entry.text).width / 2 - 16,
        y: y - fontSize,
        width: ctx.measureText(entry.text).width + 32,
        height: fontSize * 2,
        time: Number(this.lines[entry.index]?.startTime) || 0,
      });
      y += overview.lineHeight;
    });
    ctx.globalAlpha = 1;
    void dark;
  }

  private drawEdgeFade(): void {
    const ctx = this.ctx;
    const { width, height } = this;
    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, 'rgba(0,0,0,0.85)');
    fade.addColorStop(0.14, 'rgba(0,0,0,0)');
    fade.addColorStop(0.86, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  }

  private resolveAccent(): string {
    const accent = this.options.accent;
    if (this.options.theme === 'light') return '#2b58d8';
    return accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)
      ? accent
      : '#9fd0ff';
  }
}
