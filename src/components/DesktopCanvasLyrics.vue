<template>
  <canvas ref="canvas" class="desktop-canvas" />
</template>

<script>
/**
 * 桌面歌词的 Canvas 呈现（单句 / 逐字）。
 *
 * 副窗口没有播放器、没有音频图：
 *   - 时间来自快照的插值时钟（与经典桌面歌词一致）
 *   - 没有节拍反应，只用缓慢的呼吸值驱动发光
 *   - 透明背景（壁纸层），不画遮罩/几何形状/下一句预览
 */
import FumeRenderer from '@/visual/fume/renderer';
import GlyphRenderer from '@/visual/glyph/renderer';

const ANCHORS = { top: 0.18, center: 0.46, bottom: 0.78 };

export default {
  name: 'DesktopCanvasLyrics',
  props: {
    mode: { type: String, default: 'sentence' },
    lines: { type: Array, default: () => [] },
    activeIndex: { type: Number, default: -1 },
    timeProvider: { type: Function, default: null },
    fontFamily: { type: String, default: 'sans-serif' },
    fontSize: { type: Number, default: 32 },
    secondary: { type: String, default: 'translation' },
    accent: { type: String, default: '' },
    textColor: { type: String, default: '#ffffff' },
    position: { type: String, default: 'center' },
    /** 播放中按高帧率绘制；暂停时降到低频，省电 */
    playing: { type: Boolean, default: false },
    /** 视觉质量档：high = 桌面按刷新率绘制（不限帧） */
    quality: { type: String, default: 'balanced' },
    /** 逐字排列：line / scatter */
    layout: { type: String, default: 'line' },
    /** 逐字调参（桌面独立一份） */
    tuning: { type: Object, default: () => ({}) },
    /** 文字效果：shadow / outline / glow */
    textEffect: { type: String, default: 'shadow' },
  },
  watch: {
    lines() {
      this.renderer?.setData(this.lines, this.activeIndex);
    },
    activeIndex(value) {
      this.renderer?.setActiveIndex(value);
    },
    fontFamily() {
      this.renderer?.setOptions({ fontFamily: this.fontFamily });
    },
    fontSize() {
      this.renderer?.setOptions({ fontSize: this.fontSize });
    },
    secondary() {
      this.renderer?.setOptions({ secondary: this.secondary });
    },
    accent() {
      this.renderer?.setOptions({ accent: this.accent });
    },
    textColor() {
      this.renderer?.setOptions({ textColor: this.textColor });
    },
    position() {
      this.renderer?.setOptions({ anchorRatio: this.anchorRatio() });
    },
    quality(value) {
      this.renderer?.setOptions({ quality: value || 'balanced' });
    },
    layout() {
      // 桌面逐字只有一种“直线”（上下交错 + 随机倾斜）
      this.renderer?.setOptions({ layout: 'line' });
    },
    tuning(value) {
      this.renderer?.setOptions({ tuning: value });
    },
    textEffect(value) {
      this.renderer?.setOptions({
        textEffect: value === 'outline' || value === 'glow' ? value : 'shadow',
      });
    },
  },
  mounted() {
    const canvas = this.$refs.canvas;
    if (!canvas) return;
    const common = {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      secondary: this.secondary,
      accent: this.accent,
      theme: 'dark',
      quality: this.quality,
      anchorRatio: this.anchorRatio(),
      transparent: true,
      showNextPreview: false,
      textColor: this.textColor,
      layout: 'line',
      tuning: this.tuning,
      exitDurationSeconds: 0.25,
      textEffect: this.textEffect,
    };
    this.renderer =
      this.mode === 'glyph'
        ? new GlyphRenderer(canvas, common)
        : new FumeRenderer(canvas, {
            ...common,
            showShapes: false,
            showOverview: false,
          });
    this.renderer.setData(this.lines, this.activeIndex);
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, '__akiDesktopCanvas', {
        value: this.renderer,
        configurable: true,
      });
    }
    this.handleResize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(canvas);
    }
    window.addEventListener('resize', this.handleResize);
    this.startLoop();
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts
        .load(`700 ${Math.round(this.fontSize * 2.4)}px ${this.fontFamily}`)
        .then(() => {
          if (!this._isDestroyed) this.renderer?.setOptions({});
        })
        .catch(() => {});
    }
  },
  beforeDestroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.handleResize);
    this.renderer?.dispose();
    this.renderer = null;
    if (typeof window !== 'undefined' && window.__akiDesktopCanvas) {
      delete window.__akiDesktopCanvas;
    }
  },
  methods: {
    anchorRatio() {
      return ANCHORS[this.position] ?? ANCHORS.center;
    },
    handleResize() {
      const canvas = this.$refs.canvas;
      if (!canvas || !this.renderer) return;
      const width =
        canvas.clientWidth ||
        canvas.parentElement?.clientWidth ||
        window.innerWidth;
      const height =
        canvas.clientHeight ||
        canvas.parentElement?.clientHeight ||
        window.innerHeight;
      this.renderer.resize(width, height);
    },
    startLoop() {
      let last = 0;
      const loop = ts => {
        this.rafId = requestAnimationFrame(loop);
        if (typeof document !== 'undefined' && document.hidden) return;
        // high：播放中不限帧（跟随显示器刷新率）；其他档位约 60fps，暂停约 11fps
        const minDelta = this.playing ? (this.quality === 'high' ? 0 : 12) : 90;
        if (last && ts - last < minDelta) return;
        const dt = last
          ? Math.min(0.1, (ts - last) / 1000)
          : this.playing
          ? this.quality === 'high'
            ? 1 / 120
            : 1 / 60
          : 1 / 11;
        last = ts;
        const now = Number(this.timeProvider?.() ?? 0);
        // 没有音频：用缓慢呼吸让最新字/当前句有一点生命感
        const level = 0.08 + 0.04 * Math.sin(now * 1.2);
        this.renderer?.draw({
          now,
          dt,
          level,
          reduceMotion: false,
          playing: false,
        });
      };
      this.rafId = requestAnimationFrame(loop);
    },
  },
};
</script>

<style lang="scss" scoped>
.desktop-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
  background: transparent;
}
</style>
