// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 一键桌面开发：Vite 开发服务器 + 主进程构建（watch）+ Electron。
 * 取代上游的 `vue-cli-service electron:serve`。
 *
 * 用法：pnpm dev:electron
 */
import { createServer } from 'vite';
import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainBuildOptions } from './build-main.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. 渲染进程开发服务器（electron 模式：注入 IS_ELECTRON=true，保留真实 process）
const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
  mode: 'electron',
});
await server.listen();
server.printUrls();

// 传给主进程的地址必须是裸 origin（主进程会自行拼接 /#/library）
const devServerUrl = (
  server.resolvedUrls?.local?.[0] ?? 'http://localhost:8080/'
).replace(/\/$/, '');

// 2. 主进程：先构建一次，再进入 watch
const ctx = await context(mainBuildOptions(true));
await ctx.rebuild();
await ctx.watch();

// 3. 启动 Electron
const electronPath = (await import('electron')).default;
const electron = spawn(electronPath, [root], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: devServerUrl,
  },
});

const shutdown = async code => {
  await ctx.dispose();
  await server.close();
  if (!electron.killed) electron.kill();
  process.exit(code ?? 0);
};

electron.on('close', code => shutdown(code));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
