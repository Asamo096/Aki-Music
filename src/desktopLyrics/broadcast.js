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
import {
  CHANNELS,
  STATE_INTERVAL_MS,
  normalizeDesktopLyricsSettings,
} from '@/shared/lyricsSnapshot';
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

  // 桌面歌词窗的外观（位置/字体/大小/颜色）：真值在 settings.desktopLyrics，
  // 这里解析成可直接用的 CSS 值随快照下发，副窗口不需要自己读设置
  const desktopSetting = normalizeDesktopLyricsSettings(
    settings?.desktopLyrics
  );
  const desktopFontFamily =
    desktopSetting.fontPreset === 'inherit'
      ? resolveLyricsFontFamily(settings)
      : resolveLyricsFontFamily({
          lyricsFontPreset: desktopSetting.fontPreset,
          // custom 时 fontFamily 承载本机字体名，必须一起传进去
          lyricsFontFamily: desktopSetting.fontFamily,
        });
  const accent = options.accent || '';
  const desktopColor =
    desktopSetting.color === 'auto' ? '' : desktopSetting.color;

  ipcRenderer.send(CHANNELS.payload, {
    version: payloadVersion,
    trackId: trackId ?? null,
    lines: data?.lines ?? [],
    hasWordTiming: data?.hasWordTiming === true,
    source: data?.source ?? null,
    format: data?.format ?? null,
    track: options.track ?? null,
    style: {
      // 歌词页（远程窗口复用这套）
      fontFamily: resolveLyricsFontFamily(settings),
      fontSize: settings?.lyricFontSize || 28,
      secondary: options.secondary || 'translation',
      accent,
      // 桌面歌词窗（壁纸层）：原始设置 + 解析后的 CSS 值
      desktop: {
        // 原始设置（面板回显与 patch 都基于它：fontFamily 是"字体名"）
        ...desktopSetting,
        // 解析后的 CSS 字体栈（桌面歌词页直接用这个）
        resolvedFamily: desktopFontFamily,
        colorHex: desktopColor,
        sweep: desktopColor || accent,
      },
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
