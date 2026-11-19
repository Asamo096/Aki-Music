<template>
  <div class="desktop-lyrics" :style="rootStyle">
    <div class="lyrics-band" :class="`position-${position}`">
      <LyricLines
        :lines="lines"
        :active-index="activeIndex"
        :has-word-timing="hasWordTiming"
        :secondary="secondary"
        :auto-scroll="true"
        :time-provider="snapshotTime"
      />
    </div>
  </div>
</template>

<script>
/**
 * 桌面歌词页（壁纸层窗口的页面，M3-A）。
 *
 * 这个窗口不是独立应用：它没有播放器、没有歌词引擎，只有一个"显示"职责。
 * 数据全部来自主窗口经主进程转发的两条流（见 shared/lyricsSnapshot.js）：
 *   - payload：歌词正文 + 样式（含逐字时间轴、字体、副行类型、主题色）
 *   - state：播放位置与播放态（约 500ms）
 * 时钟在两次心跳之间由 getSnapshotTime 插值，逐字进度由 LyricLines 的 rAF 自己推进，
 * 所以心跳频率不影响歌词观感。
 *
 * 背景完全透明（窗口本身 transparent + 这里不画任何底色），只有歌词浮在桌面上；
 * 为了保证压在任意壁纸上都能读清，文字带阴影（--lyric-text-shadow）。
 */
import LyricLines from '@/components/LyricLines.vue';
import { ipcRenderer } from '@/utils/electronBridge';
import {
  CHANNELS,
  getSnapshotTime,
  isPayloadValid,
  isStateValid,
  normalizeDesktopLyricsSettings,
} from '@/shared/lyricsSnapshot';
import { findActiveLineIndex } from '@/lyrics/timing/activeLine';

/** 时钟/当前行推进间隔：50ms 与主窗口歌词页一致 */
const TICK_MS = 50;

export default {
  name: 'DesktopLyrics',
  components: {
    LyricLines,
  },
  data() {
    return {
      payload: null,
      state: null,
      activeIndex: -1,
      tickTimer: null,
    };
  },
  computed: {
    lines() {
      // 行级歌词页与桌面歌词共用同一份数据结构；这里只挑出有内容的行
      return (this.payload?.lines ?? []).filter(line => line.words.length > 0);
    },
    hasWordTiming() {
      return this.payload?.hasWordTiming === true;
    },
    secondary() {
      return this.payload?.style?.secondary || 'none';
    },
    /** 桌面歌词外观（由远程窗口的齿轮面板修改，主窗口持有真值） */
    desktopStyle() {
      return normalizeDesktopLyricsSettings(this.payload?.style?.desktop);
    },
    position() {
      return this.desktopStyle.position;
    },
    rootStyle() {
      const style = this.payload?.style || {};
      const desktop = style.desktop || {};
      return {
        fontFamily: desktop.fontFamily || style.fontFamily || undefined,
        fontSize: desktop.fontSize ? `${desktop.fontSize}px` : undefined,
        // 颜色：'auto' 时用封面主色（sweep），正文保持默认白
        color: desktop.colorHex || undefined,
        '--lyric-accent': desktop.sweep || style.accent || null,
        // 压在任意壁纸上都要看得清
        '--lyric-text-shadow': '0 2px 10px rgba(0, 0, 0, 0.82)',
        // 歌词带内部留白：视口高度由 CSS 固定，这里给一半
        '--lyric-spacer': '17vh',
      };
    },
  },
  mounted() {
    if (!ipcRenderer) return;
    this.subscribe();
    this.tickTimer = setInterval(this.tick, TICK_MS);
  },
  beforeDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (!ipcRenderer) return;
    // 只移除本组件自己的监听，不影响主窗口
    this.unsubscribe();
  },
  methods: {
    /** 插值后的当前位置（秒）—— 交给 LyricLines 驱动逐字进度 */
    snapshotTime() {
      return getSnapshotTime(this.state, Date.now());
    },
    tick() {
      const index = findActiveLineIndex(this.lines, this.snapshotTime());
      if (index !== this.activeIndex) this.activeIndex = index;
    },
    onPayload(payload) {
      if (!isPayloadValid(payload)) return;
      this.payload = payload;
      // 歌词换了，当前行立刻按新时间重算，避免沿用上一首的下标
      this.tick();
    },
    onState(state) {
      if (!isStateValid(state)) return;
      this.state = state;
    },
    subscribe() {
      // preload 的 on() 回调签名是 (占位 event, ...args)
      this.payloadHandler = (_event, p) => this.onPayload(p);
      this.stateHandler = (_event, s) => this.onState(s);
      ipcRenderer.on(CHANNELS.payload, this.payloadHandler);
      ipcRenderer.on(CHANNELS.state, this.stateHandler);
      this.requestInitialSnapshot();
    },
    unsubscribe() {
      // preload 的 on() 没有提供 off —— 窗口销毁即整体释放，这里无需动作
    },
    /**
     * 首次加载向主进程要一次缓存：主进程在 loadURL 之后立刻推过快照，
     * 可能与页面脚本注册监听存在竞争，主动拉一次可以彻底消除空窗。
     */
    async requestInitialSnapshot() {
      try {
        const snapshot = await ipcRenderer.invoke('lyrics-snapshot:request');
        if (snapshot?.payload) this.onPayload(snapshot.payload);
        if (snapshot?.state) this.onState(snapshot.state);
      } catch (error) {
        console.warn('[desktop-lyrics] 获取初始快照失败', error);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.desktop-lyrics {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  // 完全透明：背景由桌面本身提供
  background: transparent;
  overflow: hidden;
  user-select: none;

  // 歌词带：只占屏幕的一条区域，位置由"齿轮 → 位置"决定。
  // 桌面歌词在壁纸层铺满整屏，必须靠这条带子控制文字落在哪里。
  .lyrics-band {
    width: min(92vw, 1500px);
    height: 34vh;
    margin: 0 auto;
    // 隐藏滚动条；LyricLines 会用 scrollIntoView 把当前行居中
    overflow: hidden;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }

    &.position-top {
      margin-top: 8vh;
    }

    &.position-center {
      margin-top: auto;
      margin-bottom: auto;
    }

    &.position-bottom {
      margin-top: auto;
      margin-bottom: 8vh;
    }

    // 桌面歌词按居中排版（壁纸层是整屏宽，左对齐会贴到屏幕边缘）
    ::v-deep .lyric-lines .line .content {
      text-align: center;
      transform-origin: center center;
    }
  }
}
</style>
