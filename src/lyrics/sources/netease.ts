// SPDX-License-Identifier: AGPL-3.0-or-later
import request from '@/utils/request';
import { dedupe, requestKey } from '@/utils/requestCache';
import { getLyricCacheEntry, putLyricCacheEntry } from '@/utils/db';
import type { LyricData } from '../types';
import { parseLyricPayload } from '../core/parse';
import { getLyric } from '@/api/track';

/**
 * 网易云数据源（第二、三档）。
 *
 * 两者都走内嵌 API（同源），因此不存在跨域与限流问题：
 *   ② `/lyric/new` —— 逐字歌词（yrc）+ 逐字翻译（ytlrc）+ 逐字罗马音（yromalrc）
 *   ③ `/lyric`     —— 行级歌词 + 翻译 + 罗马音（兜底）
 *
 * 第三档直接复用 `api/track.js` 的 getLyric：它已带 Dexie 缓存与请求去重，
 * 不必重复实现一套。
 */

/** 逐字歌词响应的缓存有效期：歌词稳定，可放长 */
const YRC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cacheKey = (trackId: string | number) => `yrc:${trackId}`;

async function fetchLyricNew(trackId: string | number): Promise<unknown> {
  return request({
    url: '/lyric/new',
    method: 'get',
    params: { id: trackId },
  });
}

/**
 * 第二档：网易云逐字歌词。
 *
 * @returns 解析结果；歌曲没有逐字歌词（响应里 yrc 字段缺失）时返回 null
 */
export async function loadNeteaseYrc(
  trackId: string | number
): Promise<LyricData | null> {
  const key = cacheKey(trackId);

  const cached = await getLyricCacheEntry(key);
  if (cached) {
    const ttl = cached.payload ? YRC_TTL_MS : YRC_TTL_MS;
    if (Date.now() - cached.updateTime < ttl) {
      return cached.payload ? parseLyricPayload(cached.payload) : null;
    }
  }

  const payload = await dedupe(requestKey('lyric/new', { id: trackId }), () =>
    fetchLyricNew(trackId)
  );

  // 只有确实含逐字内容的响应才值得缓存
  const parsed = parseLyricPayload(payload);
  const hasYrc = Boolean(parsed && parsed.format === 'yrc');
  await putLyricCacheEntry(key, {
    payload: hasYrc ? payload : null,
    source: 'netease-yrc',
  });

  return hasYrc ? parsed : null;
}

/**
 * 第三档：行级歌词（兜底）。
 * 复用既有的 getLyric —— 它自带缓存、去重与 60 秒新鲜度门控。
 */
export async function loadNeteaseLrc(
  trackId: string | number
): Promise<LyricData | null> {
  // getLyric（api/track.js）按数字 id 建缓存键，这里统一转换
  const payload = await getLyric(Number(trackId));
  return parseLyricPayload(payload);
}
