// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 主进程读取静态资源（托盘图标、Touch Bar 图标等）的目录。
 *
 * 上游依赖 vue-cli-plugin-electron-builder 注入的 webpack 全局 `__static`，
 * 本项目改用显式模块，不再依赖构建器的隐式魔法。
 *
 * 这些资源位于 public/ 下，由 Vite 原样复制到渲染产物目录：
 * - 开发（页面由 vite dev server 提供）：<root>/public
 * - 生产（页面由本地 express 提供 dist/）：<root>/dist
 *
 * 用 app.getAppPath() 定位应用根目录，与主进程产物的输出位置无关
 * （开发时是项目根，打包后是 app.asar 根）。
 */
import path from 'node:path';
import { app } from 'electron';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

export const STATIC_DIR = path.join(
  app.getAppPath(),
  isDev ? 'public' : 'dist'
);
