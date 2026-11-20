<template>
  <canvas ref="canvas" class="fume-canvas" @click="onClick" />
</template>

<script>
/**
 * Fume 可视化模式（V2 首版）。
 *
 * 只做“壳”：把歌词、时间、字体、主题与音频帧交给 Canvas 渲染器。
 * 生命周期严格跟随组件：切模式/离开歌词页即销毁，避免常驻页泄漏。
 */
import FumeRenderer from '@/visual/fume/renderer';
import visualRuntime from '@/visual/runtime';
import { resolveAudioLevel } from '@/visual/intensity';

export default {
  name: 'FumeVisualizer',
  props: {
    lines: {
      type: Array,
      default: () => [],
    },
    activeIndex: {
      type: Number,
      default: -1,
    },
    hasWordTiming: {
      type: Boolean,
      default: false,
    },
    secondary: {
      type: String,
      default: 'translation',
    },
    timeProvider: {
      type: Function,
      default: null,
    },
    fontFamily: {
      type: String,
      default: 'sans-serif',
    },
    fontSize: {
      type: Number,
      default: 28,
    },
    accent: {
      type: String,
      default: '',
    },
    theme: {
      type: String,
      default: 'dark',
    },
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
  },
  mounted() {
    const canvas = this.$refs.canvas;
    if (!canvas) return;
    this.renderer = new FumeRenderer(canvas, {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      secondary: this.secondary,
      accent: this.accent,
      theme: this.theme === 'light' ? 'light' : 'dark',
      quality: this.$store?.state?.settings?.visualQuality || 'balanced',
    });
    this.renderer.setData(this.lines, this.activeIndex);
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, '__akiFume', {
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
    this.unsubscribe = visualRuntime.subscribe(this.onFrame);
    // 自定义/系统字体可能还没加载完：就绪后重建一次排版
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts
        .load(`600 ${this.fontSize}px ${this.fontFamily}`)
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
    this.renderer?.dispose();
    this.renderer = null;
    if (typeof window !== 'undefined' && window.__akiFume) {
      delete window.__akiFume;
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
      if (!this.renderer) return;
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
.fume-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  display: block;
}
</style>
