// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 folia-major（AGPL-3.0，https://github.com/chthollyphile/folia-major）
//   packaging/windows/wallpaper-helper/src/attach.rs
// Modified for Aki Music on 2026-10-11:
//   1. Rust + windows-rs → Node + koffi FFI（不引入 Rust 构建链，见计划书 D10）
//   2. 只保留主进程需要的部分：探针 / 挂载 / 摘除 / 几何 / z 序 / 心跳状态检查；
//      **不做鼠标转发** —— 本项目 v1 的桌面歌词是纯展示（窗口在图标层之下、
//      真实点击到不了它，也没有悬停控件可交互）。将来加悬停控件时必须同时加
//      转发（folia 的硬契约），届时再补。
//   3. 探针重试改为异步等待，避免阻塞主进程事件循环
//   4. 错误返回结构化结果，供渲染层给出可读提示
//
// attach.rs 的版权链（沿用上游声明）：
//   Derived from Seelen UI (AGPL-3.0) — 双路探针（classic + raised）、
//   0x052C 重发陷阱、样式归一化。
//   Probe criteria cross-checked against Lively Wallpaper (GPL-3.0).
//
// 关键机制（照抄，别"优化"）：
//   - classic：WorkerW 是"持有 SHELLDLL_DefView 的顶层窗口"的下一个 WorkerW 兄弟
//   - raised（Win11 24H2+）：WorkerW 是 Progman 的直接子窗口
//   - **只有找不到任何 WorkerW 时才发 0x052C**：raised WorkerW 存活时重发会让 Explorer
//     拆掉整棵桌面窗口树，挂上去的窗口随之被销毁 → 无限重挂循环
//   - 几何按**物理像素**、换算到父窗口客户区（否则高 DPI 下四周露出几像素）
/* global BigInt */
import os from 'node:os';

const PROGMAN_SPAWN_WORKERW = 0x052c;
const PROBE_RETRY_COUNT = 10;
const PROBE_RETRY_DELAY_MS = 100;

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_EX_ACCEPTFILES = 0x00000010;
const WS_EX_APPWINDOW = 0x00040000;
const WS_EX_WINDOWEDGE = 0x00000100;

const GA_PARENT = 1;
const GW_CHILD = 5;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const SWP_ASYNCWINDOWPOS = 0x4000;
const HWND_TOP = 0;

const MONITOR_DEFAULTTONEAREST = 2;
const SMTO_NORMAL = 0;

let api = null;

/** 惰性初始化：非 Windows 上永远不加载 DLL */
const getApi = () => {
  if (api) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const RECT = koffi.struct('AKI_RECT', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long',
  });
  const POINT = koffi.struct('AKI_POINT', { x: 'long', y: 'long' });
  const MonitorInfo = koffi.struct('AKI_MONITORINFO', {
    cbSize: 'uint32',
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: 'uint32',
  });
  const EnumProc = koffi.proto('int AKI_EnumProc(void* hwnd, intptr lParam)');

  api = {
    koffi,
    user32,
    RECT,
    POINT,
    MonitorInfo,
    EnumProc,
    FindWindowA: user32.func(
      'void* FindWindowA(str className, str windowName)'
    ),
    FindWindowExA: user32.func(
      'void* FindWindowExA(void* parent, void* after, str className, str windowName)'
    ),
    EnumWindows: user32.func(
      'int EnumWindows(AKI_EnumProc* cb, intptr lParam)'
    ),
    EnumChildWindows: user32.func(
      'int EnumChildWindows(void* parent, AKI_EnumProc* cb, intptr lParam)'
    ),
    GetClassNameA: user32.func(
      'int GetClassNameA(void* hwnd, void* buffer, int maxCount)'
    ),
    GetAncestor: user32.func('void* GetAncestor(void* hwnd, uint flags)'),
    GetWindow: user32.func('void* GetWindow(void* hwnd, uint cmd)'),
    SetParent: user32.func('void* SetParent(void* child, void* parent)'),
    IsWindow: user32.func('int IsWindow(void* hwnd)'),
    MonitorFromWindow: user32.func(
      'void* MonitorFromWindow(void* hwnd, uint flags)'
    ),
    GetMonitorInfoW: user32.func(
      'int GetMonitorInfoW(void* monitor, _Inout_ AKI_MONITORINFO* info)'
    ),
    GetWindowRect: user32.func(
      'int GetWindowRect(void* hwnd, _Out_ AKI_RECT* rect)'
    ),
    ScreenToClient: user32.func(
      'int ScreenToClient(void* hwnd, _Inout_ AKI_POINT* point)'
    ),
    SetWindowPos: user32.func(
      'int SetWindowPos(void* hwnd, void* insertAfter, int x, int y, int cx, int cy, uint flags)'
    ),
    SendMessageTimeoutW: user32.func(
      'intptr SendMessageTimeoutW(void* hwnd, uint msg, uintptr wParam, intptr lParam, uint flags, uint timeout, void* result)'
    ),
    GetWindowLongPtrW: user32.func(
      'longlong GetWindowLongPtrW(void* hwnd, int index)'
    ),
    SetWindowLongPtrW: user32.func(
      'longlong SetWindowLongPtrW(void* hwnd, int index, longlong value)'
    ),
    InvalidateRect: user32.func(
      'int InvalidateRect(void* hwnd, void* rect, int erase)'
    ),
    UpdateWindow: user32.func('int UpdateWindow(void* hwnd)'),
  };
  return api;
};

const H = value => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  return 0n;
};
const isNull = value => H(value) === 0n;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Electron 的窗口句柄（Buffer）→ BigInt HWND */
export const hwndFromBuffer = buffer => {
  if (!buffer || buffer.length < 4) return 0n;
  return buffer.length >= 8
    ? buffer.readBigUInt64LE(0)
    : BigInt(buffer.readUInt32LE(0));
};

const windowsBuild = () => {
  const parts = os.release().split('.').map(Number);
  return parts[2] ?? 0;
};

/**
 * 是否支持壁纸层。
 * folia 的注释指出：透明窗口只在 Win11 24H2+ 的 raised 桌面下能存活于 SetParent 之后，
 * 因此要求 build ≥ 26100，而不是"能挂上就算"。
 */
export const getWallpaperSupport = () => {
  if (process.platform !== 'win32') {
    return { supported: false, reason: 'unsupported-platform' };
  }
  const build = windowsBuild();
  if (build < 26100) {
    return { supported: false, reason: 'require-win11-24h2', build };
  }
  return { supported: true, build };
};

const classNameOf = hwnd => {
  const { GetClassNameA } = getApi();
  const buffer = Buffer.alloc(64);
  const length = GetClassNameA(H(hwnd), buffer, 64);
  return length > 0 ? buffer.toString('ascii', 0, length) : '';
};

const findProgman = () => {
  const { FindWindowA } = getApi();
  return H(FindWindowA('Progman', null));
};

const hasChildOfClass = (parent, klass) => {
  const { FindWindowExA } = getApi();
  return !isNull(FindWindowExA(H(parent), null, klass, null));
};

/** classic 探针：持有 SHELLDLL_DefView 的顶层窗口 → 它 z 序后面的 WorkerW 兄弟 */
const probeClassicWorkerW = () => {
  const { EnumWindows } = getApi();
  let found = 0n;
  EnumWindows(hwnd => {
    if (hasChildOfClass(hwnd, 'SHELLDLL_DefView')) {
      const { FindWindowExA } = getApi();
      const sibling = FindWindowExA(null, H(hwnd), 'WorkerW', null);
      if (!isNull(sibling)) {
        found = H(sibling);
        return 0; // 停止枚举
      }
    }
    return 1;
  }, 0);
  return found;
};

/** raised 探针（Win11 24H2+）：WorkerW 是 Progman 的子窗口，出现是异步的 */
const probeRaisedWorkerW = async () => {
  const { FindWindowExA } = getApi();
  const progman = findProgman();
  if (!progman || !hasChildOfClass(progman, 'SHELLDLL_DefView')) return 0n;

  for (let attempt = 0; attempt <= PROBE_RETRY_COUNT; attempt += 1) {
    const worker = FindWindowExA(H(progman), null, 'WorkerW', null);
    if (!isNull(worker)) return H(worker);
    await sleep(PROBE_RETRY_DELAY_MS);
  }
  return 0n;
};

/** 全部 WorkerW（排除承载图标的：图标层必须在壁纸层之上，不能当宿主） */
const collectWallpaperWorkers = () => {
  const { EnumWindows, EnumChildWindows } = getApi();
  const collected = [];
  let mode = 'classic';
  const collect = hwnd => {
    if (classNameOf(hwnd) !== 'WorkerW') return 1;
    if (hasChildOfClass(hwnd, 'SHELLDLL_DefView')) return 1;
    collected.push({ hwnd: H(hwnd), mode });
    return 1;
  };
  EnumWindows(collect, 0);
  const progman = findProgman();
  if (progman) {
    mode = 'raised';
    EnumChildWindows(H(progman), collect, 0);
  }
  return collected;
};

const getMonitorRect = monitor => {
  const { GetMonitorInfoW } = getApi();
  if (isNull(monitor)) return null;
  const info = { cbSize: 40 }; // sizeof(MONITORINFO)
  if (!GetMonitorInfoW(H(monitor), info) || !info.rcMonitor) return null;
  const { left, top, right, bottom } = info.rcMonitor;
  return { left, top, right, bottom };
};

const getWindowRect = hwnd => {
  const { GetWindowRect } = getApi();
  const rect = {};
  if (!GetWindowRect(H(hwnd), rect)) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
};

const overlapArea = (a, b) => {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
};

/** 为某台显示器找宿主（多显示器时每个显示器一个 WorkerW） */
const workerForMonitor = monitor => {
  const monitorRect = getMonitorRect(monitor);
  if (!monitorRect) return null;
  const monitorArea =
    (monitorRect.right - monitorRect.left) *
    (monitorRect.bottom - monitorRect.top);

  let best = null;
  for (const candidate of collectWallpaperWorkers()) {
    const rect = getWindowRect(candidate.hwnd);
    if (!rect) continue;
    const overlap = overlapArea(rect, monitorRect);
    // 覆盖不到这台显示器 80% 的不算它的壁纸层
    if (overlap * 10 < monitorArea * 8) continue;
    if (!best || overlap > best.overlap) best = { ...candidate, overlap };
  }
  return best;
};

const detectWorkerForMonitor = async monitor => {
  const byMonitor = workerForMonitor(monitor);
  if (byMonitor) return byMonitor;
  const classic = probeClassicWorkerW();
  if (classic) return { hwnd: classic, mode: 'classic' };
  const raised = await probeRaisedWorkerW();
  if (raised) return { hwnd: raised, mode: 'raised' };
  return null;
};

const normalizeStyles = hwnd => {
  const { GetWindowLongPtrW, SetWindowLongPtrW } = getApi();
  const style = BigInt.asUintN(64, H(GetWindowLongPtrW(H(hwnd), GWL_STYLE)));
  const nextStyle = (style | BigInt(WS_CHILD)) & ~BigInt(WS_CLIPSIBLINGS);
  SetWindowLongPtrW(H(hwnd), GWL_STYLE, BigInt.asIntN(64, nextStyle));

  const exStyle = BigInt.asUintN(
    64,
    H(GetWindowLongPtrW(H(hwnd), GWL_EXSTYLE))
  );
  const nextEx =
    exStyle &
    ~BigInt(WS_EX_ACCEPTFILES) &
    ~BigInt(WS_EX_APPWINDOW) &
    ~BigInt(WS_EX_WINDOWEDGE);
  SetWindowLongPtrW(H(hwnd), GWL_EXSTYLE, BigInt.asIntN(64, nextEx));
};

const restoreStyles = hwnd => {
  const { GetWindowLongPtrW, SetWindowLongPtrW } = getApi();
  const style = BigInt.asUintN(64, H(GetWindowLongPtrW(H(hwnd), GWL_STYLE)));
  const nextStyle = (style & ~BigInt(WS_CHILD)) | BigInt(WS_POPUP);
  SetWindowLongPtrW(H(hwnd), GWL_STYLE, BigInt.asIntN(64, nextStyle));

  const exStyle = BigInt.asUintN(
    64,
    H(GetWindowLongPtrW(H(hwnd), GWL_EXSTYLE))
  );
  const nextEx = exStyle | BigInt(WS_EX_APPWINDOW) | BigInt(WS_EX_WINDOWEDGE);
  SetWindowLongPtrW(H(hwnd), GWL_EXSTYLE, BigInt.asIntN(64, nextEx));
};

/** 把窗口铺满它所在显示器的物理矩形（换算到父窗口客户区坐标） */
export const fillMonitor = (hwnd, monitor) => {
  const { SetWindowPos, GetAncestor, ScreenToClient } = getApi();
  const rect = getMonitorRect(monitor);
  if (!rect) return false;

  const parent = H(GetAncestor(H(hwnd), GA_PARENT));
  const origin = { x: rect.left, y: rect.top };
  if (!isNull(parent)) ScreenToClient(parent, origin);

  return Boolean(
    SetWindowPos(
      H(hwnd),
      null,
      origin.x,
      origin.y,
      rect.right - rect.left,
      rect.bottom - rect.top,
      SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_SHOWWINDOW
    )
  );
};

/** 重新置顶（与其他壁纸软件共存时，后动者赢） */
export const reassertTop = hwnd => {
  const { SetWindowPos } = getApi();
  return Boolean(
    SetWindowPos(
      H(hwnd),
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE
    )
  );
};

/**
 * 把窗口挂到桌面图标层之下。
 * @param {Buffer|bigint} handle Electron 的 getNativeWindowHandle()
 */
export const attachToDesktop = async handle => {
  const support = getWallpaperSupport();
  if (!support.supported)
    return { ok: false, reason: support.reason, build: support.build };

  try {
    const { IsWindow, MonitorFromWindow, SendMessageTimeoutW } = getApi();
    const hwnd = typeof handle === 'bigint' ? handle : hwndFromBuffer(handle);
    if (isNull(hwnd) || !IsWindow(H(hwnd)))
      return { ok: false, reason: 'window-gone' };

    // 重挂之前记下目标显示器：SetParent 会保持父客户区坐标，
    // 挂上之后再问只会得到宿主所在的屏幕
    const targetMonitor = H(
      MonitorFromWindow(H(hwnd), MONITOR_DEFAULTTONEAREST)
    );

    let worker = await detectWorkerForMonitor(targetMonitor);
    if (!worker) {
      const progman = findProgman();
      if (!progman) return { ok: false, reason: 'progman-not-found' };
      // 只有找不到 WorkerW 时才发；重发会拆树（见文件头注释）
      SendMessageTimeoutW(
        H(progman),
        PROGMAN_SPAWN_WORKERW,
        0xd,
        0x1,
        SMTO_NORMAL,
        1000,
        null
      );
      for (
        let attempt = 0;
        attempt <= PROBE_RETRY_COUNT && !worker;
        attempt += 1
      ) {
        worker = await detectWorkerForMonitor(targetMonitor);
        if (!worker) await sleep(PROBE_RETRY_DELAY_MS);
      }
    }
    if (!worker) return { ok: false, reason: 'workerw-not-found' };

    normalizeStyles(hwnd);
    const previousParent = H(getApi().SetParent(H(hwnd), H(worker.hwnd)));
    const { GetAncestor } = getApi();
    if (isNull(previousParent) && isNull(GetAncestor(H(hwnd), GA_PARENT))) {
      restoreStyles(hwnd);
      return { ok: false, reason: 'set-parent-failed' };
    }

    fillMonitor(hwnd, targetMonitor);
    reassertTop(hwnd);

    return { ok: true, workerW: worker.hwnd, mode: worker.mode };
  } catch (error) {
    return {
      ok: false,
      reason: 'exception',
      error: String(error?.message || error),
    };
  }
};

/** 从桌面层摘除并还原样式 */
export const detachFromDesktop = handle => {
  if (process.platform !== 'win32')
    return { ok: false, reason: 'unsupported-platform' };
  try {
    const { IsWindow, GetAncestor, SetParent, InvalidateRect, UpdateWindow } =
      getApi();
    const hwnd = typeof handle === 'bigint' ? handle : hwndFromBuffer(handle);
    if (isNull(hwnd) || !IsWindow(H(hwnd)))
      return { ok: false, reason: 'window-gone' };

    const parent = H(GetAncestor(H(hwnd), GA_PARENT));
    SetParent(H(hwnd), null);
    restoreStyles(hwnd);
    // 挂载状态下被销毁时最后那一帧会留在桌面层，强制重绘一次
    if (!isNull(parent)) {
      InvalidateRect(parent, null, 1);
      UpdateWindow(parent);
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'exception',
      error: String(error?.message || error),
    };
  }
};

/** 心跳：窗口是否还挂在约定的 WorkerW 下、是否仍是其最顶层子窗口 */
export const checkAttached = (handle, expectedWorkerW) => {
  if (process.platform !== 'win32')
    return { attached: false, reason: 'unsupported-platform' };
  try {
    const { IsWindow, GetAncestor, GetWindow } = getApi();
    const hwnd = typeof handle === 'bigint' ? handle : hwndFromBuffer(handle);
    if (isNull(hwnd) || !IsWindow(H(hwnd)))
      return { attached: false, reason: 'window-gone' };

    const parent = H(GetAncestor(H(hwnd), GA_PARENT));
    if (isNull(parent)) return { attached: false, reason: 'detached' };
    if (expectedWorkerW && parent !== H(expectedWorkerW)) {
      return { attached: false, reason: 'reparented', parent };
    }
    const topChild = H(GetWindow(parent, GW_CHILD));
    return { attached: true, parent, topmost: topChild === hwnd };
  } catch (error) {
    return {
      attached: false,
      reason: 'exception',
      error: String(error?.message || error),
    };
  }
};

/** 诊断：桌面架构与当前找到的 WorkerW */
export const describeDesktop = () => {
  if (process.platform !== 'win32')
    return { platform: process.platform, workers: [] };
  try {
    const progman = findProgman();
    return {
      platform: process.platform,
      build: windowsBuild(),
      progman: String(progman),
      hasDefViewUnderProgman: hasChildOfClass(progman, 'SHELLDLL_DefView'),
      workers: collectWallpaperWorkers().map(worker => ({
        mode: worker.mode,
        rect: getWindowRect(worker.hwnd),
      })),
    };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
};

/** 供主进程心跳时把窗口重新铺满（显示器分辨率/排列变化后） */
export const refillDesktop = handle => {
  if (process.platform !== 'win32') return false;
  try {
    const { MonitorFromWindow } = getApi();
    const hwnd = typeof handle === 'bigint' ? handle : hwndFromBuffer(handle);
    return fillMonitor(
      hwnd,
      H(MonitorFromWindow(H(hwnd), MONITOR_DEFAULTTONEAREST))
    );
  } catch {
    return false;
  }
};
