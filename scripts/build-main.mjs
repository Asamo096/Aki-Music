// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 构建 Electron 主进程。
 *
 * 上游用 webpack（vue-cli-plugin-electron-builder）打包主进程；本脚本改用 esbuild。
 *
 * 打包策略：**只打包本仓库自己的代码，node_modules 依赖全部外部化**，交给
 * Electron/Node 在运行时按 node_modules 解析。上游是把依赖也打进主进程的，
 * 但那是依赖 webpack 宽松的解析规则——在 pnpm 的严格布局下，esbuild 解析不了
 * `@neteaseapireborn/api/module/*` 这类子路径导入（该包没有 exports 映射），
 * 会产生上百个解析错误。外部化后既符合 Electron 生态的常规做法，产物也小得多。
 */
import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {boolean} watch
 * @returns {import('esbuild').BuildOptions}
 */
export function mainBuildOptions(watch = false) {
  return {
    entryPoints: [path.join(root, 'src/background.js')],
    outfile: path.join(root, 'dist-electron/background.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // Electron 43 内置 Node 22
    target: 'node22',
    sourcemap: watch ? 'inline' : false,
    logLevel: 'info',
    // 一切非相对路径的导入都外部化（Node 内建模块本身也会被自动外部化）
    packages: 'external',
    alias: {
      '@': path.join(root, 'src'),
    },
    resolveExtensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const watch = process.argv.includes('--watch');
  if (watch) {
    const ctx = await context(mainBuildOptions(true));
    await ctx.watch();
    console.log('[build-main] watching…');
  } else {
    await build(mainBuildOptions(false));
    console.log('[build-main] 主进程构建完成 → dist-electron/background.js');
  }
}
