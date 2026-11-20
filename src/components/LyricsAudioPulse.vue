<template>
  <div
    class="lyrics-audio-pulse"
    aria-hidden="true"
    :style="{ '--pulse-color': color || '#5b6cff' }"
  />
</template>

<script>
/**
 * 歌词页的音频脉冲层（V1）。
 *
 * 放在背景层之上、歌词内容之下，与背景风格无关：
 * 即使背景设为「关闭」，节拍反应仍然可见。
 * 只改 opacity/transform 两个属性，不触发重排。
 */
import visualRuntime from '@/visual/runtime';
import { resolveAudioLevel } from '@/visual/intensity';

export default {
  name: 'LyricsAudioPulse',
  props: {
    /** 脉冲颜色（封面主色） */
    color: {
      type: String,
      default: '',
    },
  },
  mounted() {
    this.unsubscribe = visualRuntime.subscribe(this.onFrame);
  },
  beforeDestroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  },
  methods: {
    onFrame({ audio }) {
      const settings = this.$store?.state?.settings ?? {};
      const reduceMotion =
        settings.visualReduceMotion ||
        (typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      const level = resolveAudioLevel(audio.power, {
        enabled: settings.visualAudioReactive !== false,
        intensity: Number(settings.visualIntensity ?? 0.6),
        reduceMotion,
      });
      if (Math.abs(level - (this._level ?? 0)) < 0.01 && level !== 0) return;
      this._level = level;
      this.$el?.style?.setProperty('--pulse', level.toFixed(3));
    },
  },
};
</script>

<style lang="scss" scoped>
.lyrics-audio-pulse {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: calc(var(--pulse, 0) * 0.85);
  background: radial-gradient(
      ellipse 62% 46% at 50% 78%,
      var(--pulse-color, #5b6cff) 0%,
      transparent 68%
    ),
    radial-gradient(
      ellipse 40% 32% at 28% 38%,
      var(--pulse-color, #5b6cff) 0%,
      transparent 72%
    );
  mix-blend-mode: screen;
  filter: blur(42px);
  transform: scale(calc(1 + var(--pulse, 0) * 0.12));
  transform-origin: center;
  will-change: opacity, transform;
}
</style>
