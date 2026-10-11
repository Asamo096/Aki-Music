// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 请求层工具：in-flight 并发去重。
 *
 * 背景：同一份数据常被多处同时请求（列表项渲染、预取、切歌路径），
 * 上游会各自发起一次请求。服务端虽有 2 分钟响应缓存挡出站流量，
 * 但本地仍要付出多次往返与序列化开销。
 *
 * 语义：
 * - 相同 key 的**并发**调用共享同一个 Promise
 * - Promise 结束（无论成败）后立即释放，**不做结果缓存**
 *   —— 结果缓存由各调用点自己的 Dexie / 内存层负责，这里只管"同一时刻不重复发"
 */

/** @type {Map<string, Promise<any>>} */
const inflight = new Map();

/**
 * 并发去重。
 *
 * @template T
 * @param {string} key 请求标识（应做参数归一化，例如 ids 排序后再拼接）
 * @param {() => Promise<T>} fn 真正发起请求的函数
 * @returns {Promise<T>}
 */
export function dedupe(key, fn) {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      // 只清理自己：若期间已有新的同 key 请求顶替，不能误删它
      if (inflight.get(key) === promise) inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * 归一化请求键：把参数排序后拼接，避免"同一语义、不同顺序"被当成两次请求。
 *
 * @param {string} base 接口标识
 * @param {Record<string, unknown>} [params] 参与键的参数
 * @returns {string}
 */
export function requestKey(base, params) {
  if (!params) return base;
  const parts = Object.keys(params)
    .sort()
    .map(k => {
      const v = params[k];
      return `${k}=${Array.isArray(v) ? [...v].sort().join('|') : String(v)}`;
    });
  return `${base}?${parts.join('&')}`;
}

/** 当前在途请求数（供测试与调试） */
export function inflightCount() {
  return inflight.size;
}

/** 清空在途表（仅供测试） */
export function clearInflight() {
  inflight.clear();
}
