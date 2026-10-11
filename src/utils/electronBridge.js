// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 渲染进程访问主进程能力的统一入口。
 *
 * 上游直接使用 `window.require('electron').ipcRenderer`（依赖 nodeIntegration）。
 * 启用 contextIsolation 后渲染进程没有 `require`，改由 preload 通过 contextBridge
 * 暴露 `window.aki`。此处做一次收口，避免调用点各自判空。
 *
 * 在 Web 构建中 `window.aki` 不存在，两个导出都是 null / 空串，
 * 而相关代码路径本身又受 `process.env.IS_ELECTRON` 保护，因此不会被触发。
 */

const bridge = typeof window !== 'undefined' && window.aki ? window.aki : null;

/** 与 Electron 的 ipcRenderer 同形，但只允许白名单通道（见 src/preload.js） */
export const ipcRenderer = bridge ? bridge.ipcRenderer : null;

/** 主进程的真实平台标识（'win32' / 'darwin' / 'linux'）；Web 下为空串 */
export const platform = bridge ? bridge.platform : '';
