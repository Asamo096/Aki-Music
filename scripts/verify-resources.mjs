// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 资源回收验收脚本（需应用已带 --remote-debugging-port 启动）。
 *
 *   pnpm build:electron && npx electron-builder --dir
 *   "dist_electron/win-unpacked/Aki Music.exe" --remote-debugging-port=9333
 *   node scripts/verify-resources.mjs
 *
 * 验证两件事：
 *   1. 视觉模式 off ↔ Fume ↔ 逐字 连续切换时，画布被复用（最多 2 个，
 *      非激活时 opacity 0），没有反复创建/销毁合成层；
 *   2. 连续切歌后，旧的音频 Blob URL 真正被 revoke（而不是只有最后一个），
 *      JS 堆在 GC 后回到稳定范围。
 *
 * 脚本会临时切歌/切视觉模式，结束时恢复原视觉模式与当前曲目。
 */
import { execFileSync } from 'node:child_process';

const PORT = process.env.AKI_CDP_PORT || '9333';
const BASE = `http://127.0.0.1:${PORT}`;
const CANVAS_CYCLES = Number(process.env.AKI_CANVAS_CYCLES || 50);
const AUDIO_CYCLES = Number(process.env.AKI_AUDIO_CYCLES || 50);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const listTargets = async () => (await fetch(`${BASE}/json/list`)).json();

const connect = async target => {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise(resolve => {
      const messageId = ++id;
      pending.set(messageId, resolve);
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  });
  await new Promise(resolve => ws.addEventListener('open', resolve));
  await send('Runtime.enable');
  await send('HeapProfiler.enable');
  return { send, close: () => ws.close() };
};

const evaluate = async (page, expression, awaitPromise = true) => {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text
    );
  }
  return result.result?.value;
};

const collectGarbage = async page => {
  await page.send('HeapProfiler.collectGarbage');
  await sleep(150);
};

const heapMB = async page => {
  const value = await evaluate(
    page,
    'performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null'
  );
  return value;
};

const processWorkingSetMB = () => {
  if (process.platform !== 'win32') return null;
  try {
    const csv = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq Aki Music.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8' }
    );
    const total = csv
      .trim()
      .split(/\r?\n/)
      .filter(line => line.includes('Aki Music.exe'))
      .reduce((sum, line) => {
        const columns = line.split('","').map(item => item.replace(/"/g, ''));
        const raw = columns[4] || '0';
        return sum + Number(raw.replace(/[^\d]/g, '') || 0) / 1024;
      }, 0);
    return Math.round(total);
  } catch (error) {
    return null;
  }
};

const main = async () => {
  const targets = await listTargets();
  const target = targets.find(
    item => item.type === 'page' && !item.url.includes('win=')
  );
  if (!target) {
    throw new Error(
      `没有找到主窗口（CDP ${BASE}）；请带 --remote-debugging-port 启动`
    );
  }
  const page = await connect(target);

  const original = await evaluate(
    page,
    `(() => {
      const store = document.querySelector('#app').__vue__.$store;
      return {
        visualMode: store.state.settings.visualMode,
        showLyrics: store.state.showLyrics,
        trackId: store.state.player.currentTrack?.id ?? null,
        scheduler: window.__akiRequestScheduler?.getStats() || null
      };
    })()`
  );

  await collectGarbage(page);
  const baselineHeap = await heapMB(page);
  const baselineWs = processWorkingSetMB();

  /* ── 视觉模式 50 次切换 ── */
  const canvasResult = await evaluate(
    page,
    `(async () => {
      const store = document.querySelector('#app').__vue__.$store;
      if (!store.state.showLyrics) store.commit('toggleLyrics');
      const modes = ['off', 'fume', 'glyph'];
      let maxCanvases = 0;
      for (let i = 0; i < ${CANVAS_CYCLES}; i++) {
        store.commit('updateSettings', {
          key: 'visualMode',
          value: modes[i % modes.length]
        });
        await new Promise(r => setTimeout(r, 70));
        maxCanvases = Math.max(
          maxCanvases,
          document.querySelectorAll('canvas').length
        );
      }
      store.commit('updateSettings', { key: 'visualMode', value: 'off' });
      await new Promise(r => setTimeout(r, 600));
      return {
        cycles: ${CANVAS_CYCLES},
        maxCanvases,
        canvasesLeft: document.querySelectorAll('canvas').length,
        canvasesVisible: [...document.querySelectorAll('canvas')].filter(
          canvas => getComputedStyle(canvas).opacity !== '0'
        ).length,
        glyphHandleLeft: Boolean(window.__akiGlyph),
        fumeHandleLeft: Boolean(window.__akiFume),
        runtime: window.__akiVisualRuntime?.getState() || null
      };
    })()`
  );
  await collectGarbage(page);
  const canvasHeap = await heapMB(page);
  const canvasWs = processWorkingSetMB();

  /* ── 音频源 50 次切换 ── */
  const audioResult = await evaluate(
    page,
    `(async () => {
      const store = document.querySelector('#app').__vue__.$store;
      const player = store.state.player;
      if (!store.state.showLyrics) store.commit('toggleLyrics');

      const created = new Set();
      const revoked = new Set();
      const realCreate = URL.createObjectURL.bind(URL);
      const realRevoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => {
        const url = realCreate(blob);
        created.add(url);
        return url;
      };
      URL.revokeObjectURL = url => {
        revoked.add(String(url));
        return realRevoke(url);
      };

      // 只挑缓存中已有的曲目，避免把网络耗时混进回收结论
      const candidates = [...new Set(player.list)].slice(0, 24);
      const cached = [];
      for (const id of candidates) {
        try {
          const source = await player._getAudioSourceFromCache(String(id));
          if (source) cached.push(id);
        } catch (error) {
          // 缓存读失败不影响后续候选
        }
        if (cached.length >= 3) break;
      }
      const ids = cached.length >= 2 ? cached.slice(0, 3) : candidates.slice(0, 3);
      if (!ids.length) {
        return { error: '没有可切换的曲目', created: created.size };
      }

      let failures = 0;
      for (let i = 0; i < ${AUDIO_CYCLES}; i++) {
        try {
          await player._replaceCurrentTrack(ids[i % ids.length], false);
        } catch (error) {
          failures += 1;
        }
      }
      await new Promise(r => setTimeout(r, 600));
      const live = [...created].filter(url => !revoked.has(url));
      return {
        cycles: ${AUDIO_CYCLES},
        cachedIds: ids,
        failures,
        created: created.size,
        revoked: revoked.size,
        liveBlobUrls: live.length,
        records: player.createdBlobRecords.length,
        howlPresent: Boolean(player._howler)
      };
    })()`
  );
  await collectGarbage(page);
  const audioHeap = await heapMB(page);
  const audioWs = processWorkingSetMB();

  /* ── 恢复现场 ── */
  await evaluate(
    page,
    `(async () => {
      const app = document.querySelector('#app').__vue__;
      const store = app.$store;
      store.commit('updateSettings', { key: 'visualMode', value: ${JSON.stringify(
        original.visualMode
      )} });
      if (${JSON.stringify(original.showLyrics)} !== store.state.showLyrics) {
        store.commit('toggleLyrics');
      }
      if (${JSON.stringify(original.trackId)} != null) {
        try {
          await store.state.player._replaceCurrentTrack(
            ${JSON.stringify(original.trackId)},
            false
          );
        } catch (error) {
          // 恢复失败不掩盖验收数据
        }
      }
      return true;
    })()`
  );

  page.close();

  const report = {
    baseline: { jsHeapMB: baselineHeap, processWorkingSetMB: baselineWs },
    canvas: {
      ...canvasResult,
      jsHeapMB: canvasHeap,
      processWorkingSetMB: canvasWs,
      processGrowthMB:
        canvasWs == null || baselineWs == null ? null : canvasWs - baselineWs,
    },
    audio: {
      ...audioResult,
      jsHeapMB: audioHeap,
      processWorkingSetMB: audioWs,
      processGrowthMB:
        audioWs == null || canvasWs == null ? null : audioWs - canvasWs,
    },
    checks: {
      // V3-GPU：画布会被复用（v-show 保留上下文），检查的是
      // 「最多 2 个画布、关闭后全部隐藏」，而不是每次销毁重建。
      canvasReuseOk:
        canvasResult.maxCanvases <= 2 &&
        canvasResult.canvasesVisible === 0 &&
        canvasResult.canvasesLeft <= 2,
      blobUrlsRecycled: (audioResult.liveBlobUrls ?? 99) <= 2,
      canvasHeapStable:
        canvasHeap == null ||
        baselineHeap == null ||
        canvasHeap - baselineHeap < 20,
      audioHeapStable:
        audioHeap == null ||
        baselineHeap == null ||
        audioHeap - baselineHeap < 30,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const failed = Object.entries(report.checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failed.length) {
    console.error(`资源回收检查未通过: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
