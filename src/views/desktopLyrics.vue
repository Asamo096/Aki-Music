<template>
  <div class="desktop-lyrics" :style="rootStyle">
    <div class="lyrics-viewport">
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
    rootStyle() {
      const style = this.payload?.style || {};
      return {
        fontFamily: style.fontFamily || undefined,
        fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
        '--lyric-accent': style.accent || null,
        // 压在任意壁纸上都要看得清：文字阴影由本页注入
        '--lyric-text-shadow': '0 2px 10px rgba(0, 0, 0, 0.82)',
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
  align-items: center;
  justify-content: center;
  // 完全透明：背景由桌面本身提供
  background: transparent;
  overflow: hidden;
  user-select: none;

  .lyrics-viewport {
    width: min(78vw, 1100px);
    height: 100%;
    // 隐藏滚动条；LyricLines 会用 scrollIntoView 把当前行居中
    overflow: hidden;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }
}
</style>
