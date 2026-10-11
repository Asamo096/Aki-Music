// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LyricData } from '../types';
import { parseLyricPayload } from '../core/parse';
import { getLyricCacheEntry, putLyricCacheEntry } from '@/utils/db';
import { dedupe, requestKey } from '@/utils/requestCache';

/**
 * AMLL TTML DB 数据源（首选）。
 *
 * 用官方 HTTP API 按网易云曲目 id 取人工校对的 TTML：
 *   GET https://api.amll.dev/v1/lyrics/get?ncmMusicId=<id>
 *   → { status, data: { lyrics: '<tt …>', musicNames, artistNames, … } }
 *
 * 两条硬约束（官方限流约 50 次/秒/IP，但没必要试探上限）：
 *   1. **串行化请求** —— 同一时刻只发一个，避免切歌/预取并发时打爆
 *   2. **结果缓存** —— 命中与「确认没收录」都缓存；后者设较短 TTL，
 *      因为数据库在持续收录新歌
 *
 * 注意：渲染进程无法自定义 User-Agent（Chromium 禁止），带的是浏览器 UA。
 * 若日后因限流受限，可改为经主进程转发（那里能设置 UA）。
 */

const AMLL_API_BASE = 'https://api.amll.dev';
const REQUEST_TIMEOUT_MS = 5000;

/** 命中缓存的有效期：歌词很稳定，可以放长 */
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 未收录的缓存有效期：数据库持续扩充，一周后允许重新探测 */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const cacheKey = (ncmId: string | number) => `amll:${ncmId}`;

/** 串行队列：保证同一时刻只有一个 AMLL 请求在途 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  // 不让单次失败卡住后续请求
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function fetchTtml(ncmId: string | number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${AMLL_API_BASE}/v1/lyrics/get?ncmMusicId=${encodeURIComponent(
        String(ncmId)
      )}`,
      { signal: controller.signal }
    );
    if (!res.ok) {
      // 404 = 未收录；429 = 限流。两者都按「本次没有」处理，交给缓存与下一档
      console.debug(`[lyrics] AMLL 返回 ${res.status}`);
      return null;
    }
    const json = await res.json();
    const ttml = json?.data?.lyrics;
    return typeof ttml === 'string' && ttml.includes('<tt') ? ttml : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取并解析 AMLL 歌词。
 *
 * @returns 解析结果；未收录 / 限流 / 超时 / 解析失败都返回 null（由调用方降级）
 */
export async function loadAmllLyrics(
  ncmId: string | number,
  preferredLangs: string[] = []
): Promise<LyricData | null> {
  const key = cacheKey(ncmId);

  const cached = await getLyricCacheEntry(key);
  if (cached) {
    const ttl = cached.payload ? HIT_TTL_MS : MISS_TTL_MS;
    if (Date.now() - cached.updateTime < ttl) {
      return cached.payload
        ? parseLyricPayload(cached.payload, { format: 'ttml', preferredLangs })
        : null;
    }
  }

  // 并发去重：同一首歌的多次请求共享一次网络往返
  const ttml = await dedupe(requestKey('amll/lyrics', { ncmId }), () =>
    serialize(() => fetchTtml(ncmId))
  );

  await putLyricCacheEntry(key, { payload: ttml, source: 'amll' });
  return ttml
    ? parseLyricPayload(ttml, { format: 'ttml', preferredLangs })
    : null;
}
