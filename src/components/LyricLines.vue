<template>
  <div class="lyric-lines" :class="{ 'word-timed': hasWordTiming }">
    <div class="line spacer" aria-hidden="true"></div>
    <div
      v-for="(line, index) in lines"
      :key="index"
      :data-line="index"
      class="line"
      :class="{
        active: index === activeIndex,
        'is-background': line.background,
        'is-duet': line.duet,
      }"
      :style="lineStyle(line)"
      @click="$emit('seek', line.startTime)"
      @dblclick="$emit('seek', line.startTime, true)"
    >
      <div class="content">
        <span
          v-if="line.words.length"
          class="text"
          @contextmenu.prevent="$emit('menu', $event, index, 'text')"
        >
          <span
            v-for="(word, wordIndex) in line.words"
            :key="wordIndex"
            class="word"
            >{{ word.text }}</span
          >
        </span>
        <span
          v-if="secondaryText(line)"
          class="translation"
          @contextmenu.prevent="$emit('menu', $event, index, 'secondary')"
          >{{ secondaryText(line) }}</span
        >
      </div>
    </div>
    <div class="line spacer end" aria-hidden="true"></div>
  </div>
</template>

<script>
/**
 * 逐字歌词渲染层（M2-A）。
 *
 * 与 folia 的 RemoteLyricOverlay 同源的做法：**不用 CSS transition 驱动进度**，
 * 而是 rAF 每帧读播放位置，把当前行每个词的进度写进 `--p` 自定义属性，
 * 由 CSS 的 `linear-gradient(..., var(--p), ...)` + `background-clip: text`
 * 把进度画成"扫过去"的亮色 —— 这是 Spotify/Apple Music 那种逐字效果的本质。
 *
 * 职责边界：
 *   - 时间轴（当前是第几行）由父组件给出（activeIndex）—— 保持与已有
 *     Touch Bar 上报、定时器逻辑一致，避免两套时钟打架
 *   - 本组件只管"当前行内部的逐字进度 + 发光 + 呼吸浮动"与自动居中滚动
 */
import {
  applyWordRevealMode,
  getLineSecondaryText,
  getLineTransitionTiming,
  getWordProgress,
} from '@/lyrics';

/** 手动滚动后暂停自动跟随的时长（毫秒） */
const SCROLL_PAUSE_MS = 6000;
/** 进度变化小于该阈值就不写样式，避免无谓的重绘 */
const PROGRESS_EPSILON = 0.002;

export default {
  name: 'LyricLines',
  props: {
    /** 引擎产出的歌词行（已带 renderHints） */
    lines: {
      type: Array,
      default: () => [],
    },
    /** 当前行下标（-1 表示前奏/间奏） */
    activeIndex: {
      type: Number,
      default: -1,
    },
    /** 是否有逐字时间（行级歌词不做扫过动画） */
    hasWordTiming: {
      type: Boolean,
      default: false,
    },
    /** 副行显示：translation | romaPronunciation | none */
    secondary: {
      type: String,
      default: 'translation',
    },
    /** 是否自动滚动到当前行 */
    autoScroll: {
      type: Boolean,
      default: true,
    },
    /**
     * 播放位置来源（秒）。默认读主窗口的播放器；
     * 桌面歌词/远程控制这类副窗口没有播放器，由外部注入插值后的时钟。
     */
    timeProvider: {
      type: Function,
      default: null,
    },
  },
  data() {
    return {
      wordEls: [],
    };
  },
  watch: {
    activeIndex() {
      this.scheduleSync();
    },
    lines() {
      this.scheduleSync();
    },
  },
  mounted() {
    this.scheduleSync();
    this.rafId = requestAnimationFrame(this.tick);
  },
  beforeDestroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.detachScrollListeners();
  },
  methods: {
    /** 等本轮 DOM 更新完再同步（watch 回调先于重渲染执行，见 cacheWordEls 注释） */
    scheduleSync() {
      this.$nextTick(() => {
        if (!this._isDestroyed) this.syncActiveLine();
      });
    },
    secondaryText(line) {
      if (this.secondary === 'none') return '';
      return getLineSecondaryText(line, this.secondary);
    },
    /** 行级节奏提示 → CSS 变量（进入/退出过渡时长、是否逐字） */
    lineStyle(line) {
      const hints = line.renderHints;
      if (!hints) return null;
      const timing = getLineTransitionTiming(
        hints.rawDuration,
        hints.lineTransitionMode,
        hints.wordRevealMode
      );
      return {
        '--line-enter': `${timing.enterDuration}s`,
        '--line-exit': `${timing.exitDuration}s`,
      };
    },
    /** 播放位置（秒）—— 主窗口用播放器，副窗口用注入的时钟 */
    currentTime() {
      if (this.timeProvider) return this.timeProvider() ?? 0;
      const player = this.$store?.state?.player;
      return player?.seek?.(null, false) ?? 0;
    },
    /**
     * 缓存当前行的词元素。
     *
     * 必须容忍"DOM 还没渲染出来"的情况：Vue 的 watch 回调先于重渲染执行，
     * 歌词刚加载完时第一次判定当前行就属于这种时序 —— 那时 `[data-line]`
     * 还不存在。所以在 watcher 里用 $nextTick 调用，并且 rAF 循环发现缓存
     * 为空时会自己再试一次（见 tick），保证逐字动画不会"卡住不亮"。
     *
     * @returns 是否成功缓存到词元素
     */
    cacheWordEls() {
      if (!this.$el?.querySelector) {
        this.wordEls = [];
        return false;
      }
      const lineEl = this.$el.querySelector(
        `[data-line="${this.activeIndex}"]`
      );
      if (!lineEl) {
        this.wordEls = [];
        return false;
      }
      this.wordEls = Array.from(lineEl.querySelectorAll('.word'));
      // 换行时进度必须复位，否则上一行的残留进度会先亮一下
      for (const el of this.wordEls) {
        delete el.__akiProgress;
        el.style.setProperty('--p', '0');
      }
      return this.wordEls.length > 0;
    },
    /** 切换当前行时：缓存词元素 + 滚动 */
    syncActiveLine() {
      const ok = this.cacheWordEls();
      if (!ok || !this.autoScroll) {
        return;
      }
      this.ensureScrollListeners();
      if (Date.now() < (this.scrollPausedUntil ?? 0)) {
        return;
      }
      const lineEl = this.$el.querySelector(
        `[data-line="${this.activeIndex}"]`
      );
      lineEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    ensureScrollListeners() {
      if (this.scrollParent || !this.$el) return;
      // 滚动容器在父组件里（.lyrics-container），组件不接管它，只监听手动滚动
      const parent = this.$el.closest('.lyrics-container');
      if (!parent) return;
      this.scrollParent = parent;
      parent.addEventListener('wheel', this.onManualScroll, { passive: true });
      parent.addEventListener('touchstart', this.onManualScroll, {
        passive: true,
      });
    },
    detachScrollListeners() {
      if (!this.scrollParent) return;
      this.scrollParent.removeEventListener('wheel', this.onManualScroll);
      this.scrollParent.removeEventListener('touchstart', this.onManualScroll);
      this.scrollParent = null;
    },
    /** 用户手动滚动后短暂停止自动跟随，避免"抢滚动条" */
    onManualScroll() {
      this.scrollPausedUntil = Date.now() + SCROLL_PAUSE_MS;
    },
    tick() {
      this.rafId = requestAnimationFrame(this.tick);

      const line = this.lines[this.activeIndex];
      if (!line || !this.hasWordTiming || !line.words.length) {
        return;
      }
      // 自愈：缓存为空或数量对不上（同步时 DOM 还没渲染完 / 正在 patch），补一次
      if (this.wordEls.length !== line.words.length && !this.cacheWordEls()) {
        return;
      }

      const words = line.words;

      const now = this.currentTime();
      const mode = line.renderHints?.wordRevealMode ?? 'normal';
      const els = this.wordEls;
      const count = Math.min(els.length, words.length);

      for (let index = 0; index < count; index += 1) {
        const raw = getWordProgress(words[index], now);
        const progress = applyWordRevealMode(raw, mode);
        const el = els[index];
        const previous = el.__akiProgress;
        if (
          previous !== undefined &&
          Math.abs(previous - progress) < PROGRESS_EPSILON
        ) {
          continue;
        }
        el.__akiProgress = progress;
        el.style.setProperty('--p', progress.toFixed(3));
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.lyric-lines {
  .line {
    margin: 2px 0;
    padding: 12px 18px;
    border-radius: 12px;
    cursor: default;

    &:hover {
      background: var(--color-secondary-bg-for-transparent);
    }

    .content {
      transform-origin: center left;
      transform: scale(0.95);
      transition-property: transform, opacity;
      transition-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
      transition-duration: var(--line-exit, 0.35s);
      user-select: none;
    }

    .text,
    .translation {
      opacity: 0.28;
      transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      /* 桌面歌词等场景由外部注入阴影，保证压在任意壁纸上也能读清 */
      text-shadow: var(--lyric-text-shadow, none);
    }

    .translation {
      display: block;
      margin-top: 0.1em;
      opacity: 0.2;
      font-size: 0.925em;
    }
  }

  /* 上下留白：让首/末行也能滚到屏幕中间（原来是 margin-top/height 50vh） */
  .line.spacer {
    height: 50vh;
    margin: 0;
    padding: 0;
    flex-shrink: 0;

    &:hover {
      background: unset;
    }
  }

  .line.active {
    .content {
      transform: scale(1);
      transition-duration: var(--line-enter, 0.35s);
      animation: aki-lyric-breathe 4.2s ease-in-out infinite;
    }

    .text,
    .translation {
      opacity: 0.98;
      display: inline-block;
    }

    .translation {
      opacity: 0.65;
      display: block;
    }

    /* 发光：对整行文字做一次 drop-shadow，行级别的一次滤镜，成本可控 */
    .text {
      filter: drop-shadow(
        0 0 14px color-mix(in srgb, currentColor 32%, transparent)
      );
    }
  }

  /* 逐字扫过：进度来自 rAF 写入的 --p，渐变硬边界扫过字面。
     亮色用 --lyric-accent（多色背景会把它设成封面主题主色），未设置时回落 currentColor */
  &.word-timed .line.active .text .word {
    background-image: linear-gradient(
      90deg,
      var(--lyric-accent, currentColor) 0%,
      var(--lyric-accent, currentColor) calc(var(--p, 0) * 100%),
      color-mix(in srgb, currentColor 26%, transparent) calc(var(--p, 0) * 100%),
      color-mix(in srgb, currentColor 26%, transparent) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: currentColor;
  }

  /* 背景人声（和声）与对唱行：低一档的视觉权重 */
  .line.is-background .text {
    font-size: 0.9em;
    opacity: 0.7;
  }

  .line.is-duet .content {
    text-align: right;
  }
}

@keyframes aki-lyric-breathe {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(0, -3px, 0) scale(1.014);
  }
}

@media (prefers-reduced-motion: reduce) {
  .lyric-lines .line.active .content {
    animation: none;
  }
}
</style>
