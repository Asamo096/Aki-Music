<template>
  <div
    class="fluid-background"
    :class="{ 'reduce-motion': reduceMotion }"
    aria-hidden="true"
  >
    <!-- 封面模糊层：源图先缩到 384px（单块纹理，避免大图分块上传导致的网格闪烁） -->
    <div
      v-for="layer in layers"
      :key="layer.key"
      class="cover-layer"
      :class="{ visible: layer.visible }"
    >
      <img :src="layer.url" alt="" decoding="async" draggable="false" />
    </div>
    <!-- 取不到封面时的纯色兜底 -->
    <div
      v-if="layers.length === 0"
      class="cover-fallback"
      :style="{ backgroundColor: visualTheme.backgroundColor }"
    />

    <!-- 多颜色色块：颜色与运动速度都来自封面主题（见 visual/coverTheme.ts） -->
    <div class="blobs" :style="blobStyle">
      <div class="blob blob-a" />
      <div class="blob blob-b" />
      <div class="blob blob-c" />
    </div>

    <!-- 压暗遮罩：浅色封面会把模糊层变亮，导致白色歌词不可读 -->
    <div class="veil" :style="veilStyle" />

    <!-- 整屏调和层：让多色与封面糊在一起，而不是各说各话 -->
    <div class="tone" :style="toneStyle" />
  </div>
</template>

<script>
/**
 * 多色动态模糊背景（M2-C）。
 *
 * 技术要点来自 folia 的 FluidBackground（AGPL-3.0）：
 *   1. **不用 backdrop-filter**：整屏 backdrop-filter 在 Electron 里代价极高（每帧回读背景），
 *      改用「封面缩略图 + blur(40px) + scale(1.5)」——效果接近，成本低一个量级
 *   2. **模糊源先降采样到 384px**：40px 的模糊本来就看不出更细的细节，而大图纹理会分块上传、
 *      逐块显示（这就是"新歌进来时网格闪烁"的根因）；384px 是一块纹理，任何封面都不闪
 *   3. **切歌交叉淡入**：新封面解码完成后再上屏，旧图层等淡入结束才摘掉
 *   4. **透明度加在包装层而不是模糊层**：直接给 blur 元素做透明度动画会让浏览器每帧重算模糊
 *
 * 情绪档位（motionDuration / blobStrength）由封面调色板推断，见 coverTheme.ts；
 * 无音频图，因此运动是纯视觉的呼吸/漂移，不随节拍变化。
 */
import { FALLBACK_COVER_THEME } from '@/visual/coverTheme';
import { extractCoverTheme } from '@/visual/coverThemeExtract';
import visualRuntime from '@/visual/runtime';
import { resolveAudioLevel } from '@/visual/intensity';
import { mixHexColors } from '@/visual/themeColorMath';

/** 模糊源的最长边（见上方注释第 2 点） */
const COVER_BLUR_SOURCE_MAX = 384;
/** 交叉淡入时长（与 CSS 里的 transition 保持一致） */
const CROSS_FADE_MS = 1500;

const buildDownscaledCover = (coverUrl, maxSize) =>
  new Promise(resolve => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        if (!naturalWidth || !naturalHeight) {
          resolve(null);
          return;
        }
        const scale = Math.min(
          1,
          maxSize / Math.max(naturalWidth, naturalHeight)
        );
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (error) {
        // 跨域且没有 CORS 头的封面会污染画布：退回原图（只是可能闪烁，不影响可用性）
        console.warn('[background] 封面降采样失败，退回原图', error);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = coverUrl;
  });

export default {
  name: 'LyricsBackgroundFluid',
  props: {
    /** 当前曲目封面（带尺寸参数的原图 URL） */
    coverUrl: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      // theme：目标主题（封面解析结果）；visualTheme：渲染用主题，切歌时插值过去
      theme: { ...FALLBACK_COVER_THEME },
      visualTheme: { ...FALLBACK_COVER_THEME },
      layers: [],
      layerKey: 0,
    };
  },
  computed: {
    reduceMotion() {
      return this.$store?.state?.settings?.visualReduceMotion === true;
    },
    audioReactiveEnabled() {
      return (
        this.$store?.state?.settings?.visualAudioReactive !== false &&
        !this.reduceMotion
      );
    },
    blobStyle() {
      // 颜色不在这里绑定：切歌时由 animateBlobTheme 在 450ms 内插值，避免色块瞬切
      return {
        '--blob-duration': `${this.visualTheme.motionDuration}s`,
        '--blob-strength': String(this.visualTheme.blobStrength),
      };
    },
    toneStyle() {
      return {
        background: `linear-gradient(to bottom right, ${this.visualTheme.primaryColor}, transparent, ${this.visualTheme.secondaryColor})`,
      };
    },
    veilStyle() {
      return {
        backgroundColor: this.visualTheme.backgroundColor,
        opacity: String(this.visualTheme.veilOpacity),
      };
    },
  },
  watch: {
    coverUrl: {
      immediate: true,
      handler(url) {
        this.loadCover(url);
      },
    },
    audioReactiveEnabled(enabled) {
      this.setupAudioSubscription(enabled);
    },
  },
  mounted() {
    this.setupAudioSubscription(this.audioReactiveEnabled);
    this._blobColors = {
      primary: this.visualTheme.primaryColor,
      secondary: this.visualTheme.secondaryColor,
      accent: this.visualTheme.accentColor,
    };
    this.applyBlobColors(this._blobColors);
  },
  beforeDestroy() {
    clearTimeout(this.pruneTimer);
    if (this._themeRaf) cancelAnimationFrame(this._themeRaf);
    this.setupAudioSubscription(false);
  },
  methods: {
    applyBlobColors(colors) {
      const el = this.$el;
      if (!el?.style) return;
      el.style.setProperty('--blob-primary', colors.primary);
      el.style.setProperty('--blob-secondary', colors.secondary);
      el.style.setProperty('--blob-accent', colors.accent);
    },
    /** 切歌调色板过渡：450ms 内色块/遮罩/调和层一起插值，避免瞬切 */
    animateBlobTheme(theme) {
      const target = {
        primary: theme.primaryColor,
        secondary: theme.secondaryColor,
        accent: theme.accentColor,
        background: theme.backgroundColor,
        veilOpacity: theme.veilOpacity,
      };
      const settings = this.$store?.state?.settings ?? {};
      const reduceMotion =
        settings.visualReduceMotion ||
        (typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      if (reduceMotion || !this._blobColors) {
        this._blobColors = {
          primary: target.primary,
          secondary: target.secondary,
          accent: target.accent,
        };
        this.visualTheme = { ...theme };
        this.applyBlobColors(this._blobColors);
        return;
      }
      const from = {
        ...this._blobColors,
        background: this.visualTheme.backgroundColor,
        veilOpacity: this.visualTheme.veilOpacity,
      };
      if (this._themeRaf) cancelAnimationFrame(this._themeRaf);
      const startedAt = performance.now();
      const duration = 450;
      const step = now => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        this._blobColors = {
          primary: mixHexColors(from.primary, target.primary, eased),
          secondary: mixHexColors(from.secondary, target.secondary, eased),
          accent: mixHexColors(from.accent, target.accent, eased),
        };
        this.visualTheme = {
          ...theme,
          primaryColor: this._blobColors.primary,
          secondaryColor: this._blobColors.secondary,
          accentColor: this._blobColors.accent,
          backgroundColor: mixHexColors(
            from.background,
            target.background,
            eased
          ),
          veilOpacity:
            from.veilOpacity + (target.veilOpacity - from.veilOpacity) * eased,
        };
        this.applyBlobColors(this._blobColors);
        this._themeRaf = progress < 1 ? requestAnimationFrame(step) : 0;
      };
      this._themeRaf = requestAnimationFrame(step);
    },
    setupAudioSubscription(enabled) {
      if (enabled && !this.unsubscribeAudio) {
        this.unsubscribeAudio = visualRuntime.subscribe(this.onAudioFrame);
        return;
      }
      if (!enabled && this.unsubscribeAudio) {
        this.unsubscribeAudio();
        this.unsubscribeAudio = null;
        this._audioLevel = 0;
        this.$el?.style?.setProperty('--audio-level', '0');
      }
    },
    /**
     * 音频帧 → CSS 变量。只写两个自定义属性，不做响应式更新；
     * 变化小于阈值就跳过，避免每帧触发样式重算。
     */
    onAudioFrame({ audio }) {
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
      const next = Number(level.toFixed(3));
      if (Math.abs(next - (this._audioLevel ?? 0)) < 0.015 && next !== 0) {
        return;
      }
      this._audioLevel = next;
      const el = this.$el;
      if (!el?.style) return;
      el.style.setProperty('--audio-level', String(next));
    },
    async loadCover(url) {
      if (!url) {
        this.theme = { ...FALLBACK_COVER_THEME };
        this.layers = [];
        this.animateBlobTheme(this.theme);
        return;
      }

      const key = ++this.layerKey;
      // 主题与图层并行：颜色变化和图片淡入不必互相等待
      extractCoverTheme(url).then(theme => {
        if (key !== this.layerKey) return;
        this.theme = theme;
        /** 主题回传：歌词页用它给逐字扫过染色 */
        this.$emit('theme', theme);
        this.animateBlobTheme(theme);
      });

      const source =
        (await buildDownscaledCover(url, COVER_BLUR_SOURCE_MAX)) ?? url;
      if (key !== this.layerKey) return;

      const layer = { key, url: source, visible: false };
      this.layers.push(layer);
      await this.$nextTick();
      const mine = this.layers.find(item => item.key === key);
      if (mine) mine.visible = true;

      clearTimeout(this.pruneTimer);
      this.pruneTimer = setTimeout(() => {
        this.layers = this.layers.filter(item => item.key === key);
      }, CROSS_FADE_MS + 120);
    },
  },
};
</script>

<style lang="scss" scoped>
.fluid-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
  isolation: isolate;
  contain: paint;
  transform: translateZ(0);
}

.cover-layer,
.cover-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.cover-layer {
  // 透明度加在包装层：模糊层本身保持"烘焙"状态，不参与每帧重绘
  opacity: 0;
  transition: opacity 1.5s ease-in-out;
  will-change: opacity;

  &.visible {
    opacity: 1;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    // scale 是为了盖住模糊在边缘造成的透明带
    filter: blur(40px);
    transform: scale(1.5) translateZ(0);
    backface-visibility: hidden;
  }
}

.cover-fallback {
  opacity: 0.8;
}

.blobs {
  position: absolute;
  inset: -20%;
  opacity: calc(0.35 + var(--blob-strength, 0.5) * 0.45);
  mix-blend-mode: screen;
  will-change: transform;
  transform-origin: center;
  // 音频能量 → 整体轻微放大（只改 transform，成本低）
  transform: scale(calc(1 + var(--audio-level, 0) * 0.12));

  .blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    animation: blob-drift var(--blob-duration, 26s) ease-in-out infinite;
    will-change: transform;

    &.blob-a {
      top: 8%;
      left: 6%;
      width: 58%;
      height: 58%;
      background: radial-gradient(
        circle at 50% 50%,
        var(--blob-primary, #5b6cff) 0%,
        transparent 68%
      );
      animation-delay: -4s;
    }

    &.blob-b {
      top: 28%;
      right: 4%;
      width: 54%;
      height: 54%;
      background: radial-gradient(
        circle at 50% 50%,
        var(--blob-secondary, #7f8cff) 0%,
        transparent 70%
      );
      animation-delay: -11s;
    }

    &.blob-c {
      bottom: 4%;
      left: 22%;
      width: 50%;
      height: 50%;
      background: radial-gradient(
        circle at 50% 50%,
        var(--blob-accent, #ff7ac6) 0%,
        transparent 72%
      );
      animation-delay: -17s;
    }
  }
}

.veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tone {
  position: absolute;
  inset: 0;
  opacity: 0.4;
  mix-blend-mode: overlay;
}

@keyframes blob-drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  33% {
    transform: translate3d(4%, -5%, 0) scale(1.12);
  }
  66% {
    transform: translate3d(-5%, 4%, 0) scale(0.94);
  }
}

@media (prefers-reduced-motion: reduce) {
  .blobs .blob {
    animation: none;
  }
}

/* 设置里的“减少动态效果”：停掉漂移与音频缩放 */
.fluid-background.reduce-motion {
  .blobs .blob {
    animation: none;
  }

  .blobs {
    transform: none;
  }
}
</style>
