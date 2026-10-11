// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Vitest 全局准备。
 *
 * AMLL 的 TTML 解析器需要 `DOMParser`：浏览器（Electron 渲染进程）自带，
 * 而 Node 测试环境没有。这里补上，使解析器可在单测中运行。
 * 应用代码不需要这段 —— 见 src/lyrics/core/adapters/ttml.ts 的说明。
 */
import { DOMParser } from '@xmldom/xmldom';

if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = DOMParser;
}
