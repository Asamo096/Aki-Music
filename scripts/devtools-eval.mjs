// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 运行时验证小工具：把一段 JS 丢进**正在运行的** Electron 渲染进程里执行并打印结果。
 *
 * 用途：验证歌词/背景/窗口这类只能在真实运行环境里观察的行为（DOM、computed style、
 * store 状态）。比反复手点 UI 靠谱，也比写集成测试便宜。
 *
 * 用法：
 *   1. 带调试端口启动：pnpm dev:electron -- --remote-debugging-port=9333
 *   2. 写一个探针文件（内容是一段表达式，支持 await，最后 return 的值会被打印）：
 *        node scripts/devtools-eval.mjs probe.js
 *   3. 也可以直接内联：node scripts/devtools-eval.mjs -e "return document.title"
 *
 * 探针里可以用这些注入好的东西（来自 App 根实例，仅开发模式可用）：
 *   app / store —— 根 vue 实例与 store
 *   常用取组件实例：
 *     const walk = (c, name) => { if (!c) return null; if ((c.$options.name||'')===name) return c;
 *       for (const ch of c.$children) { const f = walk(ch, name); if (f) return f; } return null; };
 *     const lyrics = walk(app, 'Lyrics');
 *
 * 端口可用环境变量覆盖：AKI_CDP_PORT=9334 node scripts/devtools-eval.mjs probe.js
 */
import fs from 'node:fs';

const port = process.env.AKI_CDP_PORT || '9333';
const base = `http://127.0.0.1:${port}`;

const [, , probeArg] = process.argv;
const inlineIndex = process.argv.indexOf('-e');
const probeFile = inlineIndex >= 0 ? null : probeArg;
if (!probeFile && inlineIndex < 0) {
  console.error(
    '用法: node scripts/devtools-eval.mjs <probe.js> | node scripts/devtools-eval.mjs -e "<表达式>"'
  );
  process.exit(1);
}

const body =
  inlineIndex >= 0
    ? process.argv[inlineIndex + 1]
    : fs.readFileSync(probeFile, 'utf8');

const targets = await (await fetch(`${base}/json/list`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost'));
if (!page) {
  console.error(
    `没有找到页面目标（CDP ${base}）——是不是没带 --remote-debugging-port 启动？`
  );
  console.error(targets.map(t => `${t.type} ${t.url}`).join('\n'));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let messageId = 0;
const pending = new Map();
const sideLogs = [];

ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    sideLogs.push(
      'exception: ' +
        (message.params.exceptionDetails.exception?.description ?? '').split(
          '\n'
        )[0]
    );
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const { type, args } = message.params;
    sideLogs.push(
      `${type}: ${args
        .map(a => a.value ?? a.description ?? a.type)
        .join(' ')
        .slice(0, 300)}`
    );
  }
});

const send = (method, params = {}) =>
  new Promise(resolve => {
    const id = ++messageId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise(resolve => ws.addEventListener('open', resolve));
await send('Runtime.enable');

const expression = `(async function () {
  const app = document.querySelector('#app').__vue__;
  const store = app && app.$store;
  ${body}
})()`;

const result = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
});

if (result.exceptionDetails) {
  console.error('抛错:', result.exceptionDetails.exception?.description);
  process.exitCode = 1;
} else {
  console.log(
    typeof result.result.value === 'string'
      ? result.result.value
      : JSON.stringify(result.result.value, null, 1)
  );
}

if (sideLogs.length) {
  console.log(`\n—— 页面旁路日志（${sideLogs.length}）——`);
  for (const line of sideLogs.slice(-20)) console.log(line);
}

ws.close();
