<template>
  <div
    class="remote-control"
    :class="{ 'is-click-through': clickThrough, 'is-maximized': maximized }"
    :data-click-through="clickThrough ? 'active' : 'inactive'"
    :style="rootStyle"
  >
    <div class="card">
      <!-- 顶部：拖拽区 + 右上角控件（齿轮 / 穿透 / 最大化 / 关闭） -->
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
            :class="{ active: settingsOpen }"
            :title="$t('remote.desktopSettings')"
            @click="toggleSettings"
          >
            <svg-icon icon-class="settings" />
          </button>
          <button
            class="icon-button"
            :class="{ active: clickThrough, 'unlock-hint': unlockHover }"
            :title="$t('remote.clickThrough')"
            @click="toggleClickThrough"
          >
            <svg-icon icon-class="lock" />
          </button>
          <button
            class="icon-button"
            :title="maximized ? $t('remote.restore') : $t('remote.maximize')"
            @click="toggleMaximize"
          >
            <svg-icon
              :icon-class="maximized ? 'fullscreen-exit' : 'fullscreen'"
            />
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

      <!-- 桌面歌词外观（齿轮）：位置 / 字体 / 大小 / 颜色 -->
      <div v-if="settingsOpen" class="settings-panel click-through-interactive">
        <div class="row">
          <span class="label">{{ $t('remote.position') }}</span>
          <div class="segmented">
            <button
              v-for="option in positionOptions"
              :key="option.value"
              :class="{ active: desktopSetting.position === option.value }"
              @click="sendDesktopSetting({ position: option.value })"
            >
              {{ $t(option.labelKey) }}
            </button>
          </div>
        </div>

        <div class="row">
          <span class="label">{{ $t('remote.font') }}</span>
          <select
            :value="desktopSetting.fontPreset"
            @change="sendDesktopSetting({ fontPreset: $event.target.value })"
          >
            <option value="inherit">
              {{ $t('remote.followLyricsFont') }}
            </option>
            <option value="app">
              {{ $t('settings.lyricsFont.presetLabels.app') }}
            </option>
            <option value="sans">
              {{ $t('settings.lyricsFont.presetLabels.sans') }}
            </option>
            <option value="serif">
              {{ $t('settings.lyricsFont.presetLabels.serif') }}
            </option>
            <option value="mono">
              {{ $t('settings.lyricsFont.presetLabels.mono') }}
            </option>
          </select>
        </div>

        <div class="row">
          <span class="label">{{ $t('remote.size') }}</span>
          <div class="slider-row">
            <input
              v-model.number="pendingFontSize"
              type="range"
              min="16"
              max="72"
              step="2"
              @change="sendDesktopSetting({ fontSize: pendingFontSize })"
            />
            <span class="value">{{ pendingFontSize }}px</span>
          </div>
        </div>

        <div class="row">
          <span class="label">{{ $t('remote.color') }}</span>
          <div class="color-row">
            <button
              class="color-auto"
              :class="{ active: desktopSetting.color === 'auto' }"
              @click="sendDesktopSetting({ color: 'auto' })"
            >
              {{ $t('remote.colorAuto') }}
            </button>
            <input
              class="color-input"
              type="color"
              :value="
                desktopSetting.color === 'auto'
                  ? '#ffffff'
                  : desktopSetting.color
              "
              @change="sendDesktopSetting({ color: $event.target.value })"
            />
          </div>
        </div>

        <div class="hint">{{ $t('remote.desktopSettingsHint') }}</div>
      </div>

      <!-- 歌词：与歌词页同一套逐字渲染，独立滚动容器跟随当前行 -->
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
 * 远程控制窗口的页面。
 *
 * 数据源与桌面歌词相同：主窗口经主进程转发的 payload（歌词 + 样式 + 曲目）与
 * state（位置/播放态/时长）。播放命令反向走「本窗口 → 主进程 → 主窗口」，
 * 音频始终不离开主窗口。
 *
 * 齿轮面板改的是**桌面歌词窗**的外观（位置/字体/大小/颜色）。真值存在主窗口的
 * `settings.desktopLyrics`：本窗口只发 patch，主窗口落库后随下一份快照把解析好的
 * CSS 值发回来 —— 两个窗口看到的永远一致，副窗口不持有自己的设置副本。
 *
 * 点击穿透的恢复路径（必须能自己解除）：
 *   - 穿透时整页 pointer-events: none，只有右上角解锁热区内的控件例外
 *   - 主进程每 150ms 轮询光标，进入热区就临时恢复可点击；forward:true 保证 mousemove 仍可达
 *   - 热区常量只有一份（shared/lyricsSnapshot.js）
 *   - 打开齿轮面板会先关掉穿透（面板不在热区里，否则点不到）
 */
import LyricLines from '@/components/LyricLines.vue';
import { ipcRenderer } from '@/utils/electronBridge';
import {
  CHANNELS,
  DESKTOP_LYRICS_DEFAULTS,
  getSnapshotTime,
  isPayloadValid,
  isStateValid,
  normalizeDesktopLyricsSettings,
} from '@/shared/lyricsSnapshot';
import { findActiveLineIndex } from '@/lyrics/timing/activeLine';

const TICK_MS = 50;
/** 紧凑模式下歌词区高度约 52px：上下留白各一半，首/末行也能居中 */
const SPACER_COMPACT = '26px';
/** 最大化后留白按视口算 */
const SPACER_MAXIMIZED = '26vh';

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
      maximized: false,
      settingsOpen: false,
      pendingFontSize: DESKTOP_LYRICS_DEFAULTS.fontSize,
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
    /** 桌面歌词窗当前外观（面板回显用；快照是唯一真值来源） */
    desktopSetting() {
      return normalizeDesktopLyricsSettings(this.payload?.style?.desktop);
    },
    positionOptions() {
      return [
        { value: 'top', labelKey: 'remote.positionTop' },
        { value: 'center', labelKey: 'remote.positionCenter' },
        { value: 'bottom', labelKey: 'remote.positionBottom' },
      ];
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
    rootStyle() {
      return {
        '--lyric-spacer': this.maximized ? SPACER_MAXIMIZED : SPACER_COMPACT,
      };
    },
  },
  watch: {
    /** 字号滑块跟随快照回填（拖动过程中的本地值优先） */
    'desktopSetting.fontSize': {
      immediate: true,
      handler(size) {
        this.pendingFontSize = size;
      },
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
    // 最大化状态由主进程持有（窗口尺寸也在那里），页面只回显
    ipcRenderer.on(CHANNELS.remoteStatus, (_event, status) => {
      if (status) this.maximized = Boolean(status.maximized);
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
    /** 把桌面歌词外观的一处修改发给主进程（落库后回推快照） */
    sendDesktopSetting(patch) {
      if (!ipcRenderer) return;
      ipcRenderer.send(
        CHANNELS.desktopSettings,
        normalizeDesktopLyricsSettings({ ...this.desktopSetting, ...patch })
      );
    },
    toggleSettings() {
      this.settingsOpen = !this.settingsOpen;
      // 面板不在解锁热区里：穿透状态下点不到，所以打开面板前先关掉穿透
      if (this.settingsOpen && this.clickThrough) this.toggleClickThrough();
    },
    async toggleClickThrough() {
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke(
        CHANNELS.remoteClickThrough,
        !this.clickThrough
      );
      if (result?.ok) this.clickThrough = Boolean(result.status?.clickThrough);
    },
    async toggleMaximize() {
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke(CHANNELS.remoteMaximize);
      if (result?.ok) this.maximized = Boolean(result.maximized);
    },
    closeWindow() {
      if (!ipcRenderer) return;
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

  &.unlock-hint {
    background: rgba(120, 170, 255, 0.5);
  }
}

/* ── 齿轮面板：桌面歌词外观 ── */
.settings-panel {
  margin: 2px 10px 6px;
  // 紧凑窗只有 230px 高：面板内容超出时可滚动，不能被裁成点不到
  max-height: calc(100% - 96px);
  overflow-y: auto;
  scrollbar-width: thin;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  -webkit-app-region: no-drag;
  font-size: 12px;

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 26px;

    & + .row {
      margin-top: 4px;
    }
  }

  .label {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .segmented {
    display: flex;
    gap: 2px;

    button {
      padding: 2px 8px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.08);

      &.active {
        background: rgba(120, 170, 255, 0.55);
      }
    }
  }

  select {
    max-width: 130px;
    padding: 2px 4px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-family: inherit;
    color: inherit;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    justify-content: flex-end;

    input[type='range'] {
      width: 110px;
      accent-color: #7aa8ff;
    }

    .value {
      width: 40px;
      text-align: right;
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    }
  }

  .color-row {
    display: flex;
    align-items: center;
    gap: 6px;

    .color-auto {
      padding: 2px 8px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.08);

      &.active {
        background: rgba(120, 170, 255, 0.55);
      }
    }

    .color-input {
      width: 26px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
    }
  }

  .hint {
    margin-top: 6px;
    font-size: 11px;
    opacity: 0.45;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* ── 歌词区：独立滚动容器，跟随当前行 ── */
.lyric-area {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  padding: 0 6px;

  ::v-deep .lyric-lines {
    height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
    font-size: 15px;

    &::-webkit-scrollbar {
      display: none;
    }

    .line {
      padding: 3px 8px;
      margin: 0;
    }

    .translation {
      font-size: 0.86em;
    }
  }
}

.is-maximized .lyric-area ::v-deep .lyric-lines {
  font-size: 30px;

  .line {
    padding: 8px 12px;
    margin: 2px 0;
  }

  // 最大化后整屏宽：居中排版更好读
  .line .content {
    text-align: center;
    transform-origin: center center;
  }
}

.no-lyric {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
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

/* 最大化后控件放大一档 */
.is-maximized .controls {
  gap: 18px;

  .icon-button {
    width: 34px;
    height: 34px;

    .svg-icon {
      width: 18px;
      height: 18px;
    }
  }

  .icon-button.play {
    width: 44px;
    height: 44px;

    .svg-icon {
      width: 24px;
      height: 24px;
    }
  }
}
</style>
