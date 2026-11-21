<template>
  <canvas ref="canvas" class="glyph-canvas" @click="onClick" />
</template>

<script>
/**
 * 「逐字歌词」可视化外壳（V2.1）。
 * 同一个共享 rAF、同一套歌词与时间源；切模式/离页即销毁。
 */
import GlyphRenderer from '@/visual/glyph/renderer';
import visualRuntime from '@/visual/runtime';
import { resolveAudioLevel } from '@/visual/intensity';

export default {
  name: 'GlyphVisualizer',
  props: {
    lines: { type: Array, default: () => [] },
    activeIndex: { type: Number, default: -1 },
    secondary: { type: String, default: 'translation' },
    timeProvider: { type: Function, default: null },
    fontFamily: { type: String, default: 'sans-serif' },
    fontSize: { type: Number, default: 28 },
    accent: { type: String, default: '' },
    theme: { type: String, default: 'dark' },
    tuning: { type: Object, default: () => ({}) },
    /** 为 false 时组件保留 canvas/上下文但不绘制（模式切换复用，避免 GPU 纹理反复创建） */
    active: { type: Boolean, default: true },
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
    theme(value) {
      this.renderer?.setOptions({
        theme: value === 'light' ? 'light' : 'dark',
      });
    },
    tuning(value) {
      this.renderer?.setOptions({ tuning: value });
    },
    active(value) {
      if (!value) return;
      this.$nextTick(() => {
        this.handleResize();
        this.renderer?.setOptions({});
      });
    },
  },
  mounted() {
    const canvas = this.$refs.canvas;
    if (!canvas) return;
    this.renderer = new GlyphRenderer(canvas, {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      secondary: this.secondary,
      accent: this.accent,
      theme: this.theme === 'light' ? 'light' : 'dark',
      quality: this.$store?.state?.settings?.visualQuality || 'balanced',
      tuning: this.tuning,
    });
    this.renderer.setData(this.lines, this.activeIndex);
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, '__akiGlyph', {
        value: this.renderer,
        configurable: true,
      });
    }
    this.handleResize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(canvas);
    }
    canvas.addEventListener('click', this.onClick);
    window.addEventListener('resize', this.handleResize);
    this.unsubscribe = visualRuntime.subscribe(this.onFrame);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts
        .load(`700 ${this.fontSize}px ${this.fontFamily}`)
        .then(() => {
          if (!this._isDestroyed) this.renderer?.setOptions({});
        })
        .catch(() => {});
    }
  },
  beforeDestroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.$refs.canvas?.removeEventListener('click', this.onClick);
    window.removeEventListener('resize', this.handleResize);
    this.renderer?.dispose();
    this.renderer = null;
    if (typeof window !== 'undefined' && window.__akiGlyph) {
      delete window.__akiGlyph;
    }
  },
  methods: {
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
    onFrame({ dt, audio }) {
      if (!this.renderer || !this.active) return;
      const settings = this.$store?.state?.settings ?? {};
      const quality = settings.visualQuality || 'balanced';
      if (quality !== this._quality) {
        this._quality = quality;
        this.renderer.setOptions({ quality });
      }
      const reduceMotion =
        settings.visualReduceMotion ||
        (typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      const now = Number(
        (this.timeProvider
          ? this.timeProvider()
          : this.$store?.state?.player?.seek?.(null, false)) ?? 0
      );
      const level = resolveAudioLevel(audio.power, {
        enabled: settings.visualAudioReactive !== false,
        intensity: Number(settings.visualIntensity ?? 0.6),
        reduceMotion,
      });
      this.renderer.draw({
        now,
        dt,
        level,
        reduceMotion,
        playing: Boolean(this.$store?.state?.player?.playing),
      });
    },
    onClick(event) {
      const canvas = this.$refs.canvas;
      if (!canvas || !this.renderer) return;
      const rect = canvas.getBoundingClientRect();
      const time = this.renderer.hitTest(
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      if (time !== null && time !== undefined) this.$emit('seek', time);
    },
  },
};
</script>

<style lang="scss" scoped>
.glyph-canvas {
  transition: opacity 0.18s ease;

  &.is-inactive {
    opacity: 0;
    pointer-events: none;
  }
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  display: block;
}
</style>
