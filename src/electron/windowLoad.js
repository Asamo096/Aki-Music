// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 副窗口加载辅助。
 *
 * 为什么不用 `await win.loadURL(...)` 判断成败：
 * 开发模式下 Vite 的 HMR 客户端在首屏期间可能触发一次**整页刷新**（新增依赖、
 * 服务端重启等），首个导航会以 ERR_FAILED/ERR_ABORTED 被 stopLoading 打断，
 * loadURL 的 Promise 随即 reject —— 但页面其实已经加载好了。把这种打断当失败，
 * 会导致窗口刚建好就被销毁，表现为"偶尔打不开副窗口"。
 *
 * 这里以 `did-finish-load`（主框架 onload 完成）为准，并保留一个超时兜底：
 * 只要最终 URL 已就位，就算加载成功。
 */
export function loadAndWait(win, url, { timeout = 10000 } = {}) {
  return new Promise(resolve => {
    if (!win || win.isDestroyed()) {
      resolve(false);
      return;
    }
    const wc = win.webContents;
    let settled = false;

    const cleanup = () => {
      wc.removeListener('did-finish-load', onFinish);
      clearTimeout(timer);
    };
    const finish = ok => {
      if (settled) return;
      settled = true;
      cleanup();
      console.log(
        `[window-load] done ok=${ok} url=${
          wc.isDestroyed() ? '(destroyed)' : wc.getURL()
        }`
      );
      resolve(ok);
    };
    const onFinish = () => finish(true);

    console.log(`[window-load] loadURL ${url}`);
    const timer = setTimeout(() => {
      // 超时：只要当前 URL 已经是目标页，就认为可用（HMR 打断后可能停在 reload 中）
      const current = wc.isDestroyed() ? '' : wc.getURL();
      finish(Boolean(current && current.startsWith(url.split('?')[0])));
    }, timeout);

    wc.once('did-finish-load', onFinish);
    // 诊断：主框架加载失败时把 Chromium 的错误码/描述打出来（生产下也保留，仅 warn）
    wc.on(
      'did-fail-load',
      (event, code, description, failedUrl, isMainFrame) => {
        if (!isMainFrame) return;
        console.warn(
          `[window-load] 主框架加载失败 ${code} ${description} ${failedUrl}`
        );
      }
    );

    // 打断（ERR_ABORTED / 导航被替换）不算失败，等后续导航完成
    win.loadURL(url).catch(error => {
      if (!settled) {
        console.warn(
          '[window-load] 首个导航被打断，等待最终加载态',
          error?.code ?? error
        );
      }
    });
  });
}
