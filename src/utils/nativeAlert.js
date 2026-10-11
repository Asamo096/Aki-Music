// SPDX-License-Identifier: AGPL-3.0-or-later
import { ipcRenderer } from '@/utils/electronBridge';

/**
 * 与运行时环境匹配的 alert 函数。
 *
 * 存在理由：Electron 在 Windows 上有个 bug —— 用户关闭浏览器原生 alert 后，
 * `<input>` 元素会失去焦点能力，除非切到别的窗口再切回来。
 * @see https://github.com/electron/electron/issues/19977
 *
 * 上游此处直接 `require('electron')` 取 dialog（依赖 nodeIntegration）。
 * 渲染进程沙箱化后没有 `require`，改为经 preload 的白名单桥调用主进程的
 * `show-native-alert`（见 src/preload.js 与 src/electron/ipcMain.js）。
 *
 * 行为差异：主进程的 showMessageBoxSync 会阻塞主进程，而这里是异步返回，
 * 调用方在对话框关闭前就会继续执行。现有调用点均忽略返回值，影响可忽略。
 */
const nativeAlert = (() => {
  if (process.env.IS_ELECTRON === true && ipcRenderer) {
    return message =>
      ipcRenderer.invoke('show-native-alert', String(message ?? ''));
  }
  return alert;
})();

export default nativeAlert;
