// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 桌面歌词窗口（壁纸层，Windows）。
 *
 * 行为：
 *   1. 建一个透明、无边框、不占任务栏的窗口，加载渲染进程的 `?win=desktop-lyrics`
 *   2. Windows 上把它挂进桌面图标层之下（WorkerW，见 electron/wallpaper.js）
 *   3. 每 5 秒做一次健康检查：家长被换掉（Explorer 重启 / 其它壁纸软件）就重挂，
 *      重挂失败超过上限则自动关窗并把原因回报给主窗口 —— 不留下"看起来开着其实没挂上"的状态
 *   4. 关闭时先摘除再销毁，避免最后一帧留在桌面层上
 *
 * 与 folia 的差异：
 *   - 不做鼠标转发（v1 是纯展示，窗口在图标层之下也没有可交互控件）
 *   - 不做"透明模式切换 → 重建窗口"的播放交接：音频始终在主窗口里，
 *     这个窗口只显示歌词，开/关它不影响播放（见计划书 M3-C 的记录）
 */
import { BrowserWindow, screen } from 'electron';
import {
  attachToDesktop,
  checkAttached,
  detachFromDesktop,
  getWallpaperSupport,
  refillDesktop,
  reassertTop,
} from './wallpaper';
import {
  CHANNELS,
  MAX_REATTACH_ATTEMPTS,
  WALLPAPER_HEARTBEAT_MS,
} from '@/shared/lyricsSnapshot';
import { loadAndWait } from './windowLoad';

let win = null;
let attached = null; // { handle: Buffer, workerW: bigint, mode: string }
let heartbeatTimer = null;
let reattachAttempts = 0;
let lastError = '';
let reportStatus = () => {};
let cached = { payload: null, state: null };

/** @param {(status: object) => void} fn */
export const setStatusReporter = fn => {
  reportStatus = typeof fn === 'function' ? fn : () => {};
};

const status = () => ({
  open: Boolean(win && !win.isDestroyed()),
  attached: Boolean(attached),
  mode: attached?.mode ?? null,
  error: lastError,
});

const emitStatus = () => reportStatus(status());

const loadUrl = () => {
  const base = process.env.VITE_DEV_SERVER_URL || 'http://localhost:27232';
  return `${base}/?win=desktop-lyrics`;
};

const clearHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

const startHeartbeat = () => {
  clearHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (!win || win.isDestroyed() || !attached) return;
    const check = checkAttached(attached.handle, attached.workerW);
    if (check.attached) {
      reattachAttempts = 0;
      if (!check.topmost) reassertTop(attached.handle);
      return;
    }
    if (check.reason === 'window-gone') {
      shutdown('window-gone');
      return;
    }

    reattachAttempts += 1;
    console.warn(
      `[desktop-lyrics] 壁纸层挂载丢失（${check.reason}），第 ${reattachAttempts} 次重挂`
    );
    if (reattachAttempts > MAX_REATTACH_ATTEMPTS) {
      lastError = 'lost-desktop';
      shutdown('lost-desktop');
      return;
    }
    const result = await attachToDesktop(attached.handle);
    if (result.ok) {
      attached.workerW = result.workerW;
      attached.mode = result.mode;
      refillDesktop(attached.handle);
      emitStatus();
    }
  }, WALLPAPER_HEARTBEAT_MS);
};

const shutdown = (reason = 'closed') => {
  clearHeartbeat();
  const current = win;
  const handle = attached?.handle ?? null;
  win = null;
  attached = null;

  if (handle) {
    try {
      detachFromDesktop(handle);
    } catch (error) {
      console.warn('[desktop-lyrics] 摘除壁纸层失败', error);
    }
  }
  if (current && !current.isDestroyed()) {
    current.destroy();
  }
  if (reason !== 'closed') lastError = reason;
  emitStatus();
};

/** 向窗口推一条消息（未开窗时静默忽略） */
export const pushToDesktopLyrics = (channel, data) => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, data);
};

export const cacheSnapshot = (channel, data) => {
  if (channel === CHANNELS.payload) cached.payload = data;
  if (channel === CHANNELS.state) cached.state = data;
  pushToDesktopLyrics(channel, data);
};

export const getDesktopLyricsStatus = () => status();

/** 副窗口启动时主动拉取的缓存快照 */
export const getCachedSnapshot = () => ({
  payload: cached.payload,
  state: cached.state,
});

/** 判断某个 webContents 是否属于桌面歌词窗口 */
export const isDesktopLyricsSender = sender =>
  Boolean(win && !win.isDestroyed() && win.webContents === sender);

/**
 * 打开桌面歌词窗口。
 * @returns {Promise<{ok:boolean, reason?:string, status:object}>}
 */
export const openDesktopLyrics = async ({ preload }) => {
  console.log(
    '[desktop-lyrics] openDesktopLyrics called; exists=' +
      Boolean(win && !win.isDestroyed())
  );
  if (win && !win.isDestroyed()) return { ok: true, status: status() };

  const support = getWallpaperSupport();
  if (!support.supported) {
    lastError = support.reason;
    emitStatus();
    return { ok: false, reason: support.reason, status: status() };
  }

  lastError = '';
  const display = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // 纯展示：不抢焦点、不接受输入（窗口在图标层之下本来也拿不到点击）
    focusable: false,
    acceptFirstMouse: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false,
      // 副窗口不需要后台节流保护，但也不能让 rAF 停摆：保持默认即可
    },
  });
  win.on('closed', () => {
    if (win) shutdown('closed');
  });

  const loaded = await loadAndWait(win, loadUrl());
  if (!loaded || win.isDestroyed()) {
    console.warn('[desktop-lyrics] 页面加载失败');
    shutdown('load-failed');
    return { ok: false, reason: 'load-failed', status: status() };
  }

  const handle = win.getNativeWindowHandle();
  const result = await attachToDesktop(handle);
  if (!result.ok) {
    console.warn(
      '[desktop-lyrics] 挂载桌面失败',
      result.reason,
      result.error ?? ''
    );
    shutdown(result.reason);
    return { ok: false, reason: result.reason, status: status() };
  }

  attached = { handle, workerW: result.workerW, mode: result.mode };
  reattachAttempts = 0;
  // 用 Electron 自己的显示路径把它标成可见（不改变父子关系）
  if (!win.isDestroyed()) {
    win.showInactive();
    refillDesktop(handle);
  }
  startHeartbeat();
  emitStatus();

  // 首次打开立刻补齐缓存内容，避免空窗一帧
  if (cached.payload) pushToDesktopLyrics(CHANNELS.payload, cached.payload);
  if (cached.state) pushToDesktopLyrics(CHANNELS.state, cached.state);

  return { ok: true, status: status() };
};

/** 关闭窗口（幂等） */
export const closeDesktopLyrics = (reason = 'closed') => {
  if (!win) return;
  shutdown(reason);
};

/** 应用退出前调用：确保摘除关系，避免桌面层残留最后一帧 */
export const disposeDesktopLyrics = () => {
  shutdown('closed');
};
