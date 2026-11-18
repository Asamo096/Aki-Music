// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 主窗口侧的歌词广播（M3-A/B）。
 *
 * 主窗口是唯一的数据源：它加载歌词、读播放位置，把两条流推给主进程，
 * 再由主进程转发给桌面歌词 / 远程控制窗口：
 *   - payload：歌词正文 + 样式（换歌 / 加载完成 / 样式变更时，几十 KB）
 *   - state：播放位置与播放态（约 500ms，几十字节）
 *
 * 为什么样式跟 payload 走、位置单独走：样式一次播放内几乎不变，却能跟着歌词一起
 * 原子生效；位置每次都要变，但只有两个数字。副窗口自己插值时钟
 * （见 shared/lyricsSnapshot.js 的 getSnapshotTime），500ms 心跳不会造成跳字。
 */
import { ipcRenderer } from '@/utils/electronBridge';
import { CHANNELS, STATE_INTERVAL_MS } from '@/shared/lyricsSnapshot';
import { resolveLyricsFontFamily } from '@/settings/fontStacks';

let stateTimer = null;
let payloadVersion = 0;

/** 主窗口是否处于 Electron 环境（Web 构建下整条链路不启用） */
const available = () =>
  Boolean(ipcRenderer) && process.env.IS_ELECTRON === true;

/**
 * 发布歌词正文与样式。
 *
 * @param {string|number|null} trackId
 * @param {import('@/lyrics/types').LyricData | null} data 引擎产出的歌词（null = 无歌词）
 * @param {object} settings store.state.settings
 * @param {{ secondary?: string, accent?: string, track?: object }} options
 *        secondary：'translation' | 'romaPronunciation' | 'none'（跟歌词页的切换按钮走）
 *        track：{ name, artist, cover }（远程控制窗口要显示）
 */
export const publishLyricsPayload = (trackId, data, settings, options = {}) => {
  if (!available()) return;
  payloadVersion += 1;
  ipcRenderer.send(CHANNELS.payload, {
    version: payloadVersion,
    trackId: trackId ?? null,
    lines: data?.lines ?? [],
    hasWordTiming: data?.hasWordTiming === true,
    source: data?.source ?? null,
    format: data?.format ?? null,
    track: options.track ?? null,
    style: {
      fontFamily: resolveLyricsFontFamily(settings),
      fontSize: settings?.lyricFontSize || 28,
      secondary: options.secondary || 'translation',
      accent: options.accent || '',
    },
  });
};

/** 组装一次状态心跳 */
export const buildLyricsState = player => {
  let position = 0;
  let playing = false;
  try {
    position = player?.seek?.(null, false) ?? 0;
    playing = Boolean(player?.playing);
  } catch {
    position = 0;
  }
  let duration = 0;
  try {
    duration = (player?.currentTrack?.dt ?? 0) / 1000;
  } catch {
    duration = 0;
  }
  return {
    position,
    playing,
    at: Date.now(),
    duration,
    trackId: player?.currentTrack?.id ?? null,
  };
};

/**
 * 启动状态心跳。
 * @param {() => object} buildState 返回 buildLyricsState 的结果
 */
export const startLyricsStateBroadcast = buildState => {
  if (!available()) return;
  stopLyricsStateBroadcast();
  const tick = () => {
    try {
      const state = buildState();
      if (state) ipcRenderer.send(CHANNELS.state, state);
    } catch (error) {
      console.warn('[lyrics-broadcast] 状态心跳失败', error);
    }
  };
  tick();
  stateTimer = setInterval(tick, STATE_INTERVAL_MS);
};

export const stopLyricsStateBroadcast = () => {
  if (stateTimer) {
    clearInterval(stateTimer);
    stateTimer = null;
  }
};
