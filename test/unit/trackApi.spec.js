// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  trackFromCache: vi.fn(),
  lyricFromCache: vi.fn(),
  albumFromCache: vi.fn(),
}));

vi.mock('@/utils/request', () => ({ default: mocks.request }));
vi.mock('@/utils/common', () => ({
  mapTrackPlayableStatus: songs => songs,
}));
vi.mock('@/store', () => ({
  default: { state: { settings: { musicQuality: '320000' } } },
}));
vi.mock('@/utils/db', () => ({
  cacheTrackDetail: vi.fn(),
  cacheLyric: vi.fn(),
  cacheAlbum: vi.fn(),
  getTrackDetailFromCache: mocks.trackFromCache,
  getLyricFromCache: mocks.lyricFromCache,
  getAlbumFromCache: mocks.albumFromCache,
}));

import { getLyric, getTrackDetail } from '@/api/track';
import { getAlbum } from '@/api/album';

const emptyDetail = { songs: [], privileges: [] };

describe('缓存未命中时不发重复请求', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getTrackDetail 缓存未命中只发一次', async () => {
    mocks.trackFromCache.mockResolvedValue(undefined);
    mocks.request.mockResolvedValue(emptyDetail);
    await getTrackDetail(123);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0].url).toBe('/song/detail');
  });

  it('取消信号/优先级/作用域透传到 request 层', async () => {
    mocks.trackFromCache.mockResolvedValue(undefined);
    mocks.request.mockResolvedValue(emptyDetail);
    const controller = new AbortController();
    await getTrackDetail(123, {
      signal: controller.signal,
      priority: 'P2',
      group: 'prefetch',
    });
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      signal: controller.signal,
      priority: 'P2',
      group: 'prefetch',
    });
  });

  it('getTrackDetail 缓存命中不阻塞，且不发请求', async () => {
    mocks.trackFromCache.mockResolvedValue({
      songs: [],
      privileges: [],
      lastUpdated: Date.now(),
    });
    const result = await getTrackDetail(123);
    expect(result.songs).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('getLyric 缓存未命中只发一次', async () => {
    mocks.lyricFromCache.mockResolvedValue(undefined);
    mocks.request.mockResolvedValue({ lrc: { lyric: '' } });
    await getLyric(456);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0].url).toBe('/lyric');
  });

  it('getAlbum 缓存未命中只发一次', async () => {
    mocks.albumFromCache.mockResolvedValue(undefined);
    mocks.request.mockResolvedValue({ songs: [] });
    await getAlbum(789);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0].url).toBe('/album');
  });
});
