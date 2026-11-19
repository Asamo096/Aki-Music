// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 远程控制窗口（M3-B）。
 *
 * 一个 420×230 的透明、无边框、置顶、不占任务栏的小窗，用来在**不打断当前工作**的前提下
 * 看歌词、控播放。窗口参数与交互来自 folia 的 RemoteControlApp，取舍如下：
 *
 *   - `alwaysOnTop: 'screen-saver'` 层级：普通 'normal' 会被各种置顶工具盖住
 *   - 透明 + 圆角由页面自己画：窗口本身透明，四角不做毛玻璃（Electron 的透明窗口
 *     没有系统圆角裁剪，用 CSS 圆角 + `hasShadow:false` 更稳）
 *   - 顶部留 `-webkit-app-region: drag` 可拖动；按钮区标 `no-drag`
 *
 * 点击穿透（本窗口的关键交互，必须带恢复路径）：
 *   1. `setIgnoreMouseEvents(true, { forward: true })` —— **必须带 forward**：
 *      否则 mousemove 也收不到，窗口变成点不动的死区，用户无法自己关掉穿透
 *   2. 主进程每 150ms 轮询光标：进入右上角解锁热区就临时恢复可点击
 *   3. 渲染进程在 mousemove 里做同样的命中测试（双保险），热区常量只有一份
 *      （shared/lyricsSnapshot.js 的 UNLOCK_HOTSPOT）
 *   4. 穿透期间渲染进程把指针事件全部置 none（除解锁按钮），否则悬停样式会残留
 *
 * 播放命令走「远程窗口 → 主进程 → 主窗口」：音频始终在主窗口（见 M3-C 的记录）。
 */
import { BrowserWindow, ipcMain, screen } from 'electron';
import {
  CHANNELS,
  CLICK_THROUGH_POLL_MS,
  normalizeDesktopLyricsSettings,
  WINDOW_QUERY_KEY,
  WINDOW_REMOTE,
  isInUnlockHotspot,
} from '@/shared/lyricsSnapshot';
import { loadAndWait } from './windowLoad';

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 230;
/** 默认位置：右下角，距屏幕边缘 24px */
const MARGIN = 24;

let win = null;
/** 紧凑尺寸（默认）与最大化时的窗口尺寸 */
let maximized = false;
let clickThroughEnabled = false;
/**
 * 解锁热区：**由渲染进程实测右上角控件区域后上报**（CSS 像素 = DIP）。
 * 之前写死 84×40，而控件有四个按钮（约 110px 宽），靠右的两个能点、靠左的
 * 经常被自己穿透掉 —— 热区必须跟着真实布局走。
 */
let unlockHotspot = null;
/** 渲染进程 mousemove 最近一次解锁提示的时间：短时间内以它为准，轮询不抢 */
let lastRenderHintAt = 0;
let hotspotPolling = null;
let unlockHover = false;
let reportStatus = () => {};
let cached = { payload: null, state: null };

export const setRemoteStatusReporter = fn => {
  reportStatus = typeof fn === 'function' ? fn : () => {};
};

const status = () => ({
  open: Boolean(win && !win.isDestroyed()),
  clickThrough: clickThroughEnabled,
  unlockHover,
  maximized,
});

const emitStatus = () => {
  const snapshot = status();
  reportStatus(snapshot);
  // 自己也收一份：最大化状态由主进程持有，页面据此回显按钮
  pushToRemote(CHANNELS.remoteStatus, snapshot);
};

const loadUrl = () => {
  const base = process.env.VITE_DEV_SERVER_URL || 'http://localhost:27232';
  return `${base}/?${WINDOW_QUERY_KEY}=${WINDOW_REMOTE}`;
};

/** 应用点击穿透状态（唯一的 setIgnoreMouseEvents 调用点） */
const applyIgnoreMouseEvents = () => {
  if (!win || win.isDestroyed()) return;
  const ignore = clickThroughEnabled && !unlockHover;
  win.setIgnoreMouseEvents(ignore, { forward: true });
  win.webContents.send('remote:click-through-state', {
    enabled: clickThroughEnabled,
    unlockHover,
  });
};

/** 光标是否落在解锁热区（坐标为窗口客户区 DIP） */
const isCursorInHotspot = () => {
  if (!win || win.isDestroyed()) return false;
  const bounds = win.getBounds();
  const cursor = screen.getCursorScreenPoint();
  // 无边框窗口：窗口坐标即客户区坐标（DIP）
  const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  if (unlockHotspot) {
    return (
      point.x >= unlockHotspot.x &&
      point.x <= unlockHotspot.x + unlockHotspot.width &&
      point.y >= unlockHotspot.y &&
      point.y <= unlockHotspot.y + unlockHotspot.height
    );
  }
  // 兜底：渲染进程还没上报时按右侧一条估算
  const content = win.getContentBounds();
  return isInUnlockHotspot(point, {
    width: content.width,
    height: content.height,
  });
};

const startHotspotPolling = () => {
  stopHotspotPolling();
  hotspotPolling = setInterval(() => {
    if (!win || win.isDestroyed() || !clickThroughEnabled) return;
    // 渲染进程的 mousemove 更及时（进入热区立刻解锁）；它刚说过话就别抢
    if (Date.now() - lastRenderHintAt < 400) return;
    const next = isCursorInHotspot();
    if (process.env.AKI_DEBUG_REMOTE) {
      const bounds = win.getBounds();
      const cursor = screen.getCursorScreenPoint();
      console.log(
        `[remote] poll cursor=${cursor.x},${cursor.y} bounds=${bounds.x},${bounds.y},${bounds.width}x${bounds.height} inHotspot=${next}`
      );
    }
    if (next !== unlockHover) {
      unlockHover = next;
      applyIgnoreMouseEvents();
      emitStatus();
    }
  }, CLICK_THROUGH_POLL_MS);
};

const stopHotspotPolling = () => {
  if (hotspotPolling) {
    clearInterval(hotspotPolling);
    hotspotPolling = null;
  }
};

export const isRemoteOpen = () => Boolean(win && !win.isDestroyed());

/** 判断某个 webContents 是否属于远程控制窗口（快照请求/命令转发用） */
export const isRemoteSender = sender =>
  Boolean(win && !win.isDestroyed() && win.webContents === sender);

export const getRemoteStatus = () => status();

export const pushToRemote = (channel, data) => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, data);
};

/** 快照广播：主窗口推来的数据同时给桌面歌词与远程窗口 */
export const cacheRemoteSnapshot = (channel, data) => {
  if (channel === CHANNELS.payload) cached.payload = data;
  if (channel === CHANNELS.state) cached.state = data;
  pushToRemote(channel, data);
};

export const getRemoteCachedSnapshot = () => ({ ...cached });

const shutdown = () => {
  console.log('[remote] 关闭窗口');
  stopHotspotPolling();
  clickThroughEnabled = false;
  unlockHover = false;
  maximized = false;
  unlockHotspot = null;
  const current = win;
  win = null;
  if (current && !current.isDestroyed()) current.destroy();
  emitStatus();
};

/**
 * 打开远程控制窗口。
 * @param {{preload: string}} options
 */
export const openRemote = async ({ preload }) => {
  console.log('[remote] openRemote called; exists=' + isRemoteOpen());
  if (isRemoteOpen()) return { ok: true, status: status() };

  clickThroughEnabled = false;
  unlockHover = false;
  maximized = false;
  unlockHotspot = null;

  const initial = compactBounds();

  win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');

  win.on('closed', () => {
    if (win) shutdown();
  });

  const loaded = await loadAndWait(win, loadUrl());
  if (!loaded || win.isDestroyed()) {
    console.warn('[remote] 页面加载失败');
    shutdown();
    return { ok: false, reason: 'load-failed', status: status() };
  }

  if (!win.isDestroyed()) win.showInactive();
  emitStatus();

  if (cached.payload) pushToRemote(CHANNELS.payload, cached.payload);
  if (cached.state) pushToRemote(CHANNELS.state, cached.state);

  return { ok: true, status: status() };
};

export const closeRemote = () => {
  if (!win) return;
  shutdown();
};

const compactBounds = () => {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  return {
    x: workArea.x + workArea.width - WINDOW_WIDTH - MARGIN,
    y: workArea.y + workArea.height - WINDOW_HEIGHT - MARGIN,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  };
};

const expandedBounds = () => {
  // 用窗口当前所在显示器：最大化跟着窗口走，而不是永远回主屏
  const display = win
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const { workArea } = display;
  return {
    x: workArea.x + MARGIN,
    y: workArea.y + MARGIN,
    width: Math.max(WINDOW_WIDTH, workArea.width - MARGIN * 2),
    height: Math.max(WINDOW_HEIGHT, workArea.height - MARGIN * 2),
  };
};

/**
 * 最大化 / 还原。
 * 不用 win.maximize()：无边框透明窗口在 Windows 上最大化会丢掉圆角与阴影表现，
 * 而且会变成"全屏"而不是"留边"；这里直接按工作区改 bounds，行为可预期。
 */
export const toggleRemoteMaximize = () => {
  if (!isRemoteOpen()) return { ok: false, status: status() };
  maximized = !maximized;
  win.setBounds(maximized ? expandedBounds() : compactBounds(), false);
  emitStatus();
  return { ok: true, maximized, status: status() };
};

/**
 * 切换点击穿透。
 * @returns {{ok:boolean, status:object}}
 */
export const setRemoteClickThrough = enabled => {
  if (!isRemoteOpen()) return { ok: false, status: status() };
  clickThroughEnabled = Boolean(enabled);
  unlockHover = false;
  applyIgnoreMouseEvents();
  if (clickThroughEnabled) startHotspotPolling();
  else stopHotspotPolling();
  emitStatus();
  return { ok: true, status: status() };
};

/**
 * 注册远程窗口相关的 IPC。由 background.js 调用一次。
 */
export const initRemoteIpc = ({ mainWindow, preload }) => {
  const isMain = event =>
    Boolean(mainWindow) && event.sender === mainWindow.webContents;

  ipcMain.handle(CHANNELS.remoteToggle, async event => {
    // 主窗口用于开/关；远程窗口自身也用这个通道关闭（右上角 ×）
    const fromRemote =
      win && !win.isDestroyed() && event.sender === win.webContents;
    if (!isMain(event) && !fromRemote) {
      return { ok: false, reason: 'forbidden' };
    }
    if (fromRemote) {
      // 远程窗口只能关自己：避免把"点关闭"变成再开一个
      closeRemote();
      return { ok: true, status: status() };
    }
    if (isRemoteOpen()) {
      closeRemote();
      return { ok: true, status: status() };
    }
    return openRemote({ preload });
  });
  ipcMain.handle(CHANNELS.remoteClickThrough, (event, enabled) => {
    const allowed =
      isMain(event) ||
      (win && !win.isDestroyed() && event.sender === win.webContents);
    if (!allowed) return { ok: false, reason: 'forbidden' };
    return setRemoteClickThrough(enabled);
  });

  // 远程窗口 → 主进程 → 主窗口（播放命令）
  ipcMain.handle(CHANNELS.remoteMaximize, event => {
    const allowed =
      isMain(event) ||
      (win && !win.isDestroyed() && event.sender === win.webContents);
    if (!allowed) return { ok: false, reason: 'forbidden' };
    return toggleRemoteMaximize();
  });

  ipcMain.on('remote:hotspot', (event, rect) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (
      !rect ||
      !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k])) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return;
    }
    unlockHotspot = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    // 布局变了就立刻按新热区重算一次（最大化/还原时控件会变大）
    if (clickThroughEnabled) {
      const next = isCursorInHotspot();
      if (next !== unlockHover) {
        unlockHover = next;
        applyIgnoreMouseEvents();
        emitStatus();
      }
    }
  });

  // 渲染进程 mousemove：光标进入/离开解锁热区（比 150ms 轮询快一个数量级）
  ipcMain.on('remote:hover-unlock', (event, inside) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    lastRenderHintAt = Date.now();
    if (!clickThroughEnabled) return;
    const next = Boolean(inside);
    if (next === unlockHover) return;
    unlockHover = next;
    applyIgnoreMouseEvents();
    emitStatus();
  });

  // 桌面歌词外观设置：远程窗口 → 主窗口（真值在 settings.desktopLyrics）
  ipcMain.on(CHANNELS.desktopSettings, (event, patch) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(
      CHANNELS.desktopSettings,
      normalizeDesktopLyricsSettings(patch)
    );
  });

  ipcMain.on(CHANNELS.remoteCommand, (event, command) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(CHANNELS.remoteCommand, command);
  });
};

export const disposeRemote = () => {
  shutdown();
};
