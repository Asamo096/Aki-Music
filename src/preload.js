// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 预加载脚本：渲染进程与主进程之间唯一的通道。
 *
 * 安全模型的要点：
 * - 渲染进程不再拥有 Node 能力（`nodeIntegration: false` + `contextIsolation: true`），
 *   拿不到 `require` / `process` / `Buffer` 等
 * - 需要主进程能力时只能走这里显式暴露的接口，且**按通道白名单**放行
 * - `contextBridge` 传递的是可结构化克隆的值，主进程对象不会被泄漏进渲染进程
 *
 * ⚠ 新增 IPC 通道时必须同步下面三张表，否则调用会被静默拒绝（仅打印警告）。
 *   三张表的取值与主进程 `ipcMain.on/handle` 注册的通道一一对应。
 */
const { contextBridge, ipcRenderer } = require('electron');

/** 渲染进程 → 主进程，单向通知 */
const SEND_CHANNELS = [
  'close',
  'maximizeOrUnmaximize',
  'metadata',
  'minimize',
  'pauseDiscordPresence',
  'playDiscordPresence',
  'player',
  'playerCurrentTrackTime',
  'removeProxy',
  'restoreDefaultShortcuts',
  'seeked',
  'sendLyrics',
  'setProxy',
  'settings',
  'switchGlobalShortcutStatusTemporary',
  'switchRepeatMode',
  'switchShuffle',
  'updateLyric',
  'updateShortcut',
  'updateTrayIcon',
  'updateTrayLikeState',
  'updateTrayPlayState',
  'updateTrayTooltip',
];

/** 渲染进程 → 主进程，需要返回值 */
const INVOKE_CHANNELS = ['unblock-music', 'show-native-alert'];

/** 主进程 → 渲染进程，事件订阅 */
const RECEIVE_CHANNELS = [
  'changeRouteTo',
  'decreaseVolume',
  'increaseVolume',
  'isMaximized',
  'like',
  'next',
  'nextUp',
  'play',
  'previous',
  'rememberCloseAppOption',
  'repeat',
  'routerGo',
  'saveLyricFinished',
  'search',
  'setPosition',
  'shuffle',
];

const warn = (kind, channel) => {
  console.warn(
    `[preload] 拒绝未在白名单中的 ${kind} 通道: "${channel}"。` +
      '新增 IPC 请同步 src/preload.js 的通道白名单。'
  );
};

contextBridge.exposeInMainWorld('aki', {
  /** 主进程的真实平台标识；渲染进程据此判断平台（见 utils/platform.js） */
  platform: process.platform,

  ipcRenderer: {
    send(channel, ...args) {
      if (!SEND_CHANNELS.includes(channel)) return warn('send', channel);
      ipcRenderer.send(channel, ...args);
    },

    invoke(channel, ...args) {
      if (!INVOKE_CHANNELS.includes(channel)) {
        warn('invoke', channel);
        return Promise.reject(new Error(`IPC 通道未授权: ${channel}`));
      }
      return ipcRenderer.invoke(channel, ...args);
    },

    on(channel, listener) {
      if (!RECEIVE_CHANNELS.includes(channel)) return warn('on', channel);
      // 不透出 IpcRendererEvent（含 sender，不可结构化克隆且有泄漏风险）。
      // 现有回调均未使用该参数，这里传空对象以保持既有函数签名不变。
      ipcRenderer.on(channel, (_event, ...args) => listener({}, ...args));
    },
  },
});
