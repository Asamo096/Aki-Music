// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fume 模式 Canvas 渲染器（V2 简化版）。
 *
 * 观感来自 Folia 的 fume：竖向歌词流、当前行居中、逐字“打印”、
 * 文字周围有烟尘/发光；这里用单个 Canvas 2D 实现（Folia 也证明
 * Pixi 版本并不更省，见 docs/视觉深化计划书.md）。
 *
 * 职责边界：
 *   - 只画歌词与粒子；背景/脉冲层由页面现有组件负责
 *   - 时间由外部传入（与歌词页/桌面歌词共用同一时钟）
 *   - 不解析歌词，不读 store，不管理播放
 */
import type { LyricLine } from '@/lyrics';
import {
  hitTestLine,
  layoutFumeLines,
  resolveCameraTarget,
  resolveSegmentProgress,
  type FumeLayout,
  type FumeSecondary,
} from './layout';

export type FumeQuality = 'high' | 'balanced' | 'low';

export interface FumeRendererOptions {
  fontFamily: string;
  fontSize: number;
  secondary: FumeSecondary;
  accent: string;
  theme: 'dark' | 'light';
  quality: FumeQuality;
}

export interface FumeDrawOptions {
  now: number;
  dt: number;
  /** 0..1 音频强度 */
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

const PARTICLE_LIMIT: Record<FumeQuality, number> = {
  high: 80,
  balanced: 44,
  low: 0,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export default class FumeRenderer {
  private canvas: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;

  private options: FumeRendererOptions;

  private lines: LyricLine[] = [];

  private activeIndex = -1;

  /** 相机跟随的最近一个有效行（间奏 activeIndex=-1 时相机不动） */
  private cameraIndex = 0;

  private layout: FumeLayout | null = null;

  private width = 0;

  private height = 0;

  private dpr = 1;

  private cameraY = 0;

  private cameraReady = false;

  private particles: Particle[] = [];

  private spawnCarry = 0;

  private disposed = false;

  private frames = 0;

  private lastDrawMs = 0;

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
    this.rebuildLayout();
  }

  setData(lines: LyricLine[], activeIndex: number): void {
    const changed = lines !== this.lines;
    this.lines = lines;
    this.activeIndex = activeIndex;
    if (activeIndex >= 0) this.cameraIndex = activeIndex;
    if (changed) {
      this.cameraIndex = activeIndex >= 0 ? activeIndex : 0;
      this.rebuildLayout();
      this.cameraReady = false;
    }
  }

  setActiveIndex(index: number): void {
    this.activeIndex = index;
    if (index >= 0) this.cameraIndex = index;
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
    this.rebuildLayout();
  }

  draw({ now, dt, level, reduceMotion, playing }: FumeDrawOptions): void {
    if (this.disposed || !this.layout) return;
    const startedAt = performance.now();
    const ctx = this.ctx;
    const { width, height } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // 间奏（activeIndex=-1）时相机保持在上一个有效行，不要跳回第一行
    const target = resolveCameraTarget(this.layout, this.cameraIndex, height);
    if (reduceMotion || !this.cameraReady) {
      this.cameraY = target;
      this.cameraReady = true;
    } else {
      const alpha = 1 - Math.exp(-Math.max(0, dt) * 7);
      this.cameraY += (target - this.cameraY) * alpha;
    }

    const dark = this.options.theme !== 'light';
    const base = dark ? '255,255,255' : '24,24,24';
    const accent = this.resolveAccent();

    // 整页压暗/提亮：保证任何封面背景上歌词都可读（暗色主题压暗，浅色主题提亮）
    ctx.fillStyle = dark ? 'rgba(8,10,16,0.34)' : 'rgba(255,255,255,0.46)';
    ctx.fillRect(0, 0, width, height);

    this.drawScrim();
    this.drawParticles({ dt, level, reduceMotion, playing, accent });

    const fontSize = this.options.fontSize;
    const segmentHeight = this.layout.segmentHeight;
    const translationHeight = this.layout.translationHeight;
    const columnX = this.layout.columnX;

    for (const box of this.layout.boxes) {
      const y = box.y + this.cameraY;
      if (y > height + box.height || y + box.height < -height) continue;
      const isActive = box.index === this.activeIndex;
      const alpha = isActive ? 1 : box.index < this.activeIndex ? 0.26 : 0.4;

      ctx.font = `600 ${fontSize}px ${this.options.fontFamily}`;
      const progress = resolveSegmentProgress(box.line, box.segments, now);

      box.segments.forEach((text, segmentIndex) => {
        if (!text) return;
        const top = y + segmentIndex * segmentHeight;
        const progressOfSegment = isActive ? progress[segmentIndex] ?? 0 : 1;
        const dimAlpha = alpha * (isActive ? 0.42 : 0.55);
        ctx.globalAlpha = dimAlpha;
        ctx.fillStyle = `rgb(${base})`;
        if (dark) {
          ctx.shadowColor = 'rgba(0,0,0,0.45)';
          ctx.shadowBlur = 12;
        }
        ctx.fillText(text, columnX, top);
        ctx.shadowBlur = 0;

        if (isActive && progressOfSegment > 0) {
          ctx.save();
          ctx.beginPath();
          const widthOfSegment = ctx.measureText(text).width;
          ctx.rect(
            columnX,
            top,
            Math.max(0, widthOfSegment * progressOfSegment),
            segmentHeight
          );
          ctx.clip();
          const glow = this.options.quality !== 'low';
          ctx.globalAlpha = clamp(0.72 + level * 0.28, 0, 1);
          ctx.fillStyle = accent;
          if (glow) {
            ctx.shadowColor = accent;
            ctx.shadowBlur = 10 + level * 30;
          }
          ctx.fillText(text, columnX, top);
          ctx.restore();
          ctx.shadowBlur = 0;
        } else {
          // 已唱过的行保持低亮白色，未唱的行略亮
          ctx.globalAlpha = alpha * 0.42;
          ctx.fillStyle = `rgb(${base})`;
          ctx.fillText(text, columnX, top);
        }
      });

      if (box.translation) {
        ctx.font = `400 ${Math.max(12, Math.round(fontSize * 0.62))}px ${
          this.options.fontFamily
        }`;
        ctx.globalAlpha = isActive ? 0.72 : alpha * 0.5;
        ctx.fillStyle = `rgb(${base})`;
        if (dark) {
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = 10;
        }
        ctx.fillText(
          box.translation,
          columnX,
          y + box.textHeight + (translationHeight - segmentHeight) * 0.2
        );
        ctx.font = `600 ${fontSize}px ${this.options.fontFamily}`;
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }

    // 让上下边缘淡出，避免歌词流被生硬切断（只影响文字，不影响背景）
    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, 'rgba(0,0,0,0.9)');
    fade.addColorStop(0.12, 'rgba(0,0,0,0)');
    fade.addColorStop(0.88, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    this.frames += 1;
    this.lastDrawMs = performance.now() - startedAt;
  }

  /** 验收用：帧数与单帧绘制耗时 */
  getStats(): { frames: number; lastDrawMs: number; particles: number } {
    return {
      frames: this.frames,
      lastDrawMs: this.lastDrawMs,
      particles: this.particles.length,
    };
  }

  hitTest(screenX: number, screenY: number): number | null {
    if (!this.layout) return null;
    const box = hitTestLine(this.layout, this.cameraY, screenY);
    if (!box) return null;
    // 只在文字列附近响应，避免整屏点击都 seek
    const left = this.layout.columnX;
    const right = left + this.layout.columnWidth;
    if (screenX < left - 40 || screenX > right + 40) return null;
    return Number(box.line.startTime) || 0;
  }

  dispose(): void {
    this.disposed = true;
    this.particles = [];
    this.layout = null;
    this.lines = [];
  }

  /** 文字列背后的柔和底色：保证亮背景上也能读清 */
  private drawScrim(): void {
    if (!this.layout) return;
    const ctx = this.ctx;
    const { columnX, columnWidth } = this.layout;
    const dark = this.options.theme !== 'light';
    const color = dark ? '0,0,0' : '255,255,255';
    const alpha = dark ? 0.26 : 0.34;
    const left = Math.max(0, columnX - 32);
    const right = Math.min(this.width, columnX + columnWidth + 32);
    const gradient = ctx.createLinearGradient(left, 0, right, 0);
    gradient.addColorStop(0, `rgba(${color},0)`);
    gradient.addColorStop(0.14, `rgba(${color},${alpha})`);
    gradient.addColorStop(0.86, `rgba(${color},${alpha})`);
    gradient.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(left, 0, right - left, this.height);
  }

  private resolveAccent(): string {
    const accent = this.options.accent;
    if (this.options.theme === 'light') return '#2b58d8';
    return accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)
      ? accent
      : '#9fd0ff';
  }

  private rebuildLayout(): void {
    if (!this.ctx || !this.width) return;
    const measure = (text: string): number => {
      this.ctx.font = `600 ${this.options.fontSize}px ${this.options.fontFamily}`;
      return this.ctx.measureText(text).width;
    };
    this.layout = layoutFumeLines(this.lines, {
      width: this.width,
      height: this.height,
      fontSize: this.options.fontSize,
      measure,
      secondary: this.options.secondary,
    });
  }

  private drawParticles({
    dt,
    level,
    reduceMotion,
    playing,
    accent,
  }: {
    dt: number;
    level: number;
    reduceMotion: boolean;
    playing: boolean;
    accent: string;
  }): void {
    const limit = PARTICLE_LIMIT[this.options.quality];
    if (!limit || reduceMotion || !this.layout) {
      this.particles = [];
      return;
    }
    if (!playing || level <= 0.03) {
      this.particles = this.particles.filter(particle => particle.life > 0);
    } else {
      this.spawnCarry += dt * (6 + level * 16);
      while (this.spawnCarry >= 1) {
        this.spawnCarry -= 1;
        if (this.particles.length >= limit) break;
        const box =
          this.layout.boxes[
            clamp(
              this.activeIndex,
              0,
              Math.max(0, this.layout.boxes.length - 1)
            )
          ];
        if (!box) break;
        const life = 1.4 + Math.random() * 2.2;
        this.particles.push({
          x:
            this.layout.columnX + Math.random() * this.layout.columnWidth * 0.9,
          y: box.y + Math.random() * box.height,
          vx: (Math.random() - 0.5) * 12,
          vy: -8 - Math.random() * 26,
          life,
          maxLife: life,
          size: 0.8 + Math.random() * 2,
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
      ctx.globalAlpha = clamp(ratio * ratio * 0.22 * (0.4 + level), 0, 0.5);
      ctx.beginPath();
      ctx.arc(
        particle.x,
        particle.y + this.cameraY,
        particle.size * (0.6 + ratio * 0.8),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter(particle => particle.life > 0);
  }
}
