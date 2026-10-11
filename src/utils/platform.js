// SPDX-License-Identifier: AGPL-3.0-or-later
import { platform } from '@/utils/electronBridge';

/**
 * 运行平台标识。
 *
 * 上游直接读 `process.platform`：那时渲染进程开着 nodeIntegration，能拿到真实的
 * `process`。启用 contextIsolation 后渲染进程没有 `process` 了，改由 preload
 * 通过 contextBridge 暴露（`window.aki.platform`）。
 *
 * 主进程仍有真实的 `process`，所以本模块两边都能用：
 * - 主进程：window 不存在 → 回退到 process.platform
 * - 渲染进程：走 window.aki.platform
 * - Web 构建：两者都没有 → 空串，三个判断均为 false（与上游 Web 端行为一致）
 *
 * 注：正因为这里不再出现字面量 `process.platform`，vite.config.ts 中那条
 * 为 Web 构建准备的 define 也就不需要了。
 */
const current =
  platform ||
  (typeof process !== 'undefined' && process.platform ? process.platform : '');

export const isWindows = current === 'win32';
export const isMac = current === 'darwin';
export const isLinux = current === 'linux';
export const isDevelopment = process.env.NODE_ENV === 'development';

export const isCreateTray = isWindows || isLinux || isDevelopment;
export const isCreateMpris = isLinux;
