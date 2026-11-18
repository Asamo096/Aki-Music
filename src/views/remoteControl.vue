<template>
  <div
    class="remote-control"
    :class="{ 'is-click-through': clickThrough }"
    :data-click-through="clickThrough ? 'active' : 'inactive'"
  >
    <div class="card">
      <!-- 顶部：拖拽区 + 右上角控件 -->
      <div class="header">
        <div class="now-playing">
          <img
            v-if="cover"
            class="cover"
            :src="cover"
            alt=""
            draggable="false"
          />
          <div class="meta">
            <div class="title" :title="title">{{ title || 'Aki Music' }}</div>
            <div class="artist" :title="artist">{{ artist }}</div>
          </div>
        </div>
        <div class="window-actions click-through-interactive">
          <button
            class="icon-button"
            :class="{ active: clickThrough, 'unlock-hint': unlockHover }"
            :title="$t('remote.clickThrough')"
            @click="toggleClickThrough"
          >
            <svg-icon icon-class="fullscreen" />
          </button>
          <button
            class="icon-button"
            :title="$t('remote.close')"
            @click="closeWindow"
          >
            <svg-icon icon-class="x" />
          </button>
        </div>
      </div>

      <!-- 歌词：与歌词页同一套逐字渲染 -->
      <div class="lyric-area">
        <LyricLines
          v-if="hasLyrics"
          :lines="lines"
          :active-index="activeIndex"
          :has-word-timing="hasWordTiming"
          :secondary="secondary"
          :auto-scroll="true"
          :time-provider="snapshotTime"
        />
        <div v-else class="no-lyric">
          {{ $t('lyricsPage.notAvailable') }}
        </div>
      </div>

      <!-- 进度 + 播放控制 -->
      <div class="footer click-through-interactive">
        <div class="progress">
          <span class="time">{{ formatTime(currentTime) }}</span>
          <div class="bar" @click="seekByClick">
            <div class="bar-inner" :style="{ width: `${progressPercent}%` }" />
          </div>
          <span class="time">{{ formatTime(duration) }}</span>
        </div>
        <div class="controls">
          <button class="icon-button" @click="sendCommand('previous')">
            <svg-icon icon-class="previous" />
          </button>
          <button class="icon-button play" @click="sendCommand('play-pause')">
            <svg-icon :icon-class="playing ? 'pause' : 'play'" />
          </button>
          <button class="icon-button" @click="sendCommand('next')">
            <svg-icon icon-class="next" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * 远程控制窗口的页面（M3-B）。
 *
 * 数据源与桌面歌词相同：主窗口经主进程转发的 payload（歌词 + 样式 + 曲目信息）
 * 与 state（位置/播放态/时长）。播放命令反向走：本窗口 → 主进程 → 主窗口执行，
 * 音频始终不离开主窗口（这也是本方案不需要播放交接的原因，见 M3-C 记录）。
 *
 * 点击穿透的安全设计（必须能自己解除）：
 *   - 穿透时整页 pointer-events: none，只有右上角"解锁热区"里的按钮例外
 *   - 主进程每 150ms 轮询光标，进入热区就临时恢复可点击（mousemove 也能收到，
 *     因为 setIgnoreMouseEvents 用了 forward:true）
 *   - 热区常量只有一份（shared/lyricsSnapshot.js），主进程与这里命中测试同一个矩形
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

const TICK_MS = 50;

export default {
  name: 'RemoteControl',
  components: { LyricLines },
  data() {
    return {
      payload: null,
      state: null,
      activeIndex: -1,
      clickThrough: false,
      unlockHover: false,
      tickTimer: null,
    };
  },
  computed: {
    lines() {
      return (this.payload?.lines ?? []).filter(line => line.words.length > 0);
    },
    hasLyrics() {
      return this.lines.length > 0;
    },
    hasWordTiming() {
      return this.payload?.hasWordTiming === true;
    },
    secondary() {
      return this.payload?.style?.secondary || 'none';
    },
    track() {
      return this.payload?.track ?? null;
    },
    title() {
      return this.track?.name ?? '';
    },
    artist() {
      return this.track?.artist ?? '';
    },
    cover() {
      return this.track?.cover ?? '';
    },
    currentTime() {
      return getSnapshotTime(this.state, Date.now());
    },
    duration() {
      return this.state?.duration ?? 0;
    },
    playing() {
      return Boolean(this.state?.playing);
    },
    progressPercent() {
      if (!this.duration) return 0;
      return Math.min(100, (this.currentTime / this.duration) * 100);
    },
  },
  mounted() {
    if (!ipcRenderer) return;
    // preload 的 on() 回调签名是 (占位 event, ...args)
    ipcRenderer.on(CHANNELS.payload, (_event, payload) => {
      if (isPayloadValid(payload)) {
        this.payload = payload;
        this.tick();
      }
    });
    ipcRenderer.on(CHANNELS.state, (_event, state) => {
      if (isStateValid(state)) this.state = state;
    });
    ipcRenderer.on('remote:click-through-state', (_event, data) => {
      this.clickThrough = Boolean(data?.enabled);
      this.unlockHover = Boolean(data?.unlockHover);
    });
    this.requestInitialSnapshot();
    this.tickTimer = setInterval(this.tick, TICK_MS);
  },
  beforeDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
  },
  methods: {
    snapshotTime() {
      return getSnapshotTime(this.state, Date.now());
    },
    tick() {
      const index = findActiveLineIndex(this.lines, this.snapshotTime());
      if (index !== this.activeIndex) this.activeIndex = index;
    },
    async requestInitialSnapshot() {
      try {
        const snapshot = await ipcRenderer.invoke('lyrics-snapshot:request');
        if (snapshot?.payload) {
          this.payload = snapshot.payload;
          this.tick();
        }
        if (snapshot?.state) this.state = snapshot.state;
      } catch (error) {
        console.warn('[remote] 获取初始快照失败', error);
      }
    },
    sendCommand(type) {
      if (!ipcRenderer) return;
      ipcRenderer.send(CHANNELS.remoteCommand, type);
    },
    async toggleClickThrough() {
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke(
        CHANNELS.remoteClickThrough,
        !this.clickThrough
      );
      if (result?.ok) this.clickThrough = Boolean(result.status?.clickThrough);
    },
    closeWindow() {
      if (!ipcRenderer) return;
      // 关闭走主进程（toggle 即"开着就关"）
      ipcRenderer.invoke(CHANNELS.remoteToggle).catch(() => {});
    },
    seekByClick(event) {
      if (!this.duration || !ipcRenderer) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width)
      );
      ipcRenderer.send(CHANNELS.remoteCommand, {
        type: 'seek',
        position: ratio * this.duration,
      });
    },
    formatTime(seconds) {
      const total = Math.max(0, Math.floor(seconds || 0));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    },
  },
};
</script>

<style lang="scss" scoped>
.remote-control {
  position: fixed;
  inset: 0;
  padding: 8px;
  // 窗口本体透明，卡片自己画圆角与底色
  background: transparent;
  user-select: none;
  overflow: hidden;

  // 穿透状态：整页不可点，解锁热区内的元素例外（恢复路径）
  &[data-click-through='active'] .card * {
    pointer-events: none !important;
  }

  &[data-click-through='active'] .click-through-interactive,
  &[data-click-through='active'] .click-through-interactive * {
    pointer-events: auto !important;
  }
}

.card {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 14px;
  background: rgba(20, 21, 26, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f2f3f7;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 4px;
  // 顶部可拖动
  -webkit-app-region: drag;

  .now-playing {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;

    .cover {
      width: 34px;
      height: 34px;
      border-radius: 7px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .meta {
      min-width: 0;
    }

    .title,
    .artist {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title {
      font-size: 13px;
      font-weight: 600;
    }

    .artist {
      font-size: 11px;
      opacity: 0.62;
    }
  }

  .window-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    -webkit-app-region: no-drag;
  }
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: 0.18s;

  .svg-icon {
    width: 14px;
    height: 14px;
    opacity: 0.82;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  &.active {
    background: rgba(255, 255, 255, 0.16);
  }

  // 穿透状态下光标进入解锁热区：给出明确的"可以点"反馈
  &.unlock-hint {
    background: rgba(120, 170, 255, 0.5);
  }
}

.lyric-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 6px;
  display: flex;
  align-items: center;

  // 远程窗口较小：歌词缩到 15px，避免只显示半个字
  ::v-deep .lyric-lines {
    font-size: 15px;
    width: 100%;

    .line {
      padding: 4px 8px;
    }
  }
}

.no-lyric {
  width: 100%;
  text-align: center;
  font-size: 12px;
  opacity: 0.5;
}

.footer {
  padding: 0 10px 8px;
}

.progress {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  opacity: 0.75;

  .bar {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
    cursor: pointer;
    overflow: hidden;
  }

  .bar-inner {
    height: 100%;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.85);
  }
}

.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 2px;

  .icon-button.play {
    width: 32px;
    height: 32px;

    .svg-icon {
      width: 18px;
      height: 18px;
      opacity: 0.95;
    }
  }
}
</style>
