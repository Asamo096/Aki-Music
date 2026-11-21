import store from '@/store';
import request from '@/utils/request';
import { mapTrackPlayableStatus } from '@/utils/common';
import { requestKey } from '@/utils/requestCache';
import {
  cacheTrackDetail,
  getTrackDetailFromCache,
  cacheLyric,
  getLyricFromCache,
} from '@/utils/db';

/**
 * 缓存被视为「足够新鲜」的时长。
 *
 * 命中缓存且未超过此时长时，不再触发后台刷新——避免同一份数据在短时间内被
 * 反复拉取（列表重渲染、预取、切歌路径都会命中同一份数据）。超过后才做一次
 * **去重**的后台刷新，兼顾新鲜度与请求量。
 */
const REVALIDATE_AFTER_MS = 60 * 1000;

/**
 * 获取音乐 url
 * 说明 : 使用歌单详情接口后 , 能得到的音乐的 id, 但不能得到的音乐 url, 调用此接口, 传入的音乐 id( 可多个 , 用逗号隔开 ), 可以获取对应的音乐的 url,
 * !!!未登录状态返回试听片段(返回字段包含被截取的正常歌曲的开始时间和结束时间)
 * @param {string} id - 音乐的 id，例如 id=405998841,33894312
 */
export function getMP3(id, options = {}) {
  const getBr = () => {
    // 当返回的 quality >= 400000时，就会优先返回 hi-res
    const quality = store.state.settings?.musicQuality ?? '320000';
    return quality === 'flac' ? '350000' : quality;
  };

  return request({
    url: '/song/url',
    method: 'get',
    params: {
      id,
      br: getBr(),
    },
    ...options,
  });
}

/**
 * 获取歌曲详情
 * 说明 : 调用此接口 , 传入音乐 id(支持多个 id, 用 , 隔开), 可获得歌曲详情(注意:歌曲封面现在需要通过专辑内容接口获取)
 * @param {string} ids - 音乐 id, 例如 ids=405998841,33894312
 */
export function getTrackDetail(ids, options = {}) {
  const idsInArray = typeof ids === 'string' ? ids.split(',') : [String(ids)];
  // 键做归一化：同一批 id 顺序不同也视为同一次请求。
  // 真正的并发合并在 request 层完成（全局调度器），这里只提供归一化键。
  const key = requestKey('song/detail', { ids: idsInArray });

  const fetchLatest = () =>
    request({
      url: '/song/detail',
      method: 'get',
      params: {
        ids,
      },
      ...options,
      dedupeKey: options.dedupeKey || key,
    }).then(data => {
      data.songs.map(song => {
        const privileges = data.privileges.find(t => t.id === song.id);
        cacheTrackDetail(song, privileges);
      });
      data.songs = mapTrackPlayableStatus(data.songs, data.privileges);
      return data;
    });

  return getTrackDetailFromCache(idsInArray).then(result => {
    if (!result) {
      // 未命中：只发一次（上游此处会先无条件发一次，未命中时再发第二次）
      return fetchLatest();
    }
    result.songs = mapTrackPlayableStatus(result.songs, result.privileges);
    // 命中：立即返回；仅在缓存偏旧时去重地刷新一次，不阻塞调用方
    if (Date.now() - (result.lastUpdated ?? 0) > REVALIDATE_AFTER_MS) {
      fetchLatest().catch(() => {});
    }
    return result;
  });
}

/**
 * 获取歌词
 * 说明 : 调用此接口 , 传入音乐 id 可获得对应音乐的歌词 ( 不需要登录 )
 * @param {number} id - 音乐 id
 */
export function getLyric(id, options = {}) {
  const key = requestKey('lyric', { id });

  const fetchLatest = () =>
    request({
      url: '/lyric',
      method: 'get',
      params: {
        id,
      },
      ...options,
      dedupeKey: options.dedupeKey || key,
    }).then(result => {
      cacheLyric(id, result);
      return result;
    });

  return getLyricFromCache(id).then(record => {
    if (!record) {
      // 未命中：只发一次
      return fetchLatest();
    }
    if (Date.now() - (record.updateTime ?? 0) > REVALIDATE_AFTER_MS) {
      fetchLatest().catch(() => {});
    }
    return record.lyrics;
  });
}

/**
 * 获取云盘歌曲内嵌歌词 * 说明 : 调用此接口 , 传入音乐 id 可获得云盘歌曲的内嵌歌词
 * @param {number} songId - 音乐 id
 * @param {number} userId - 用户 id
 */
export function getCloudLyric(songId, userId, options = {}) {
  const key = requestKey('cloud/lyric', { songId, userId });

  const fetchLatest = () =>
    request({
      url: '/api',
      method: 'get',
      params: {
        uri: `/api/cloud/lyric/get`,
        data: {
          songId,
          userId,
          lv: '-1',
          kv: '-1',
        },
        crypto: 'eapi',
      },
      ...options,
      dedupeKey: options.dedupeKey || key,
    }).then(result => {
      cacheLyric(songId, result);
      return result;
    });

  return getLyricFromCache(songId).then(record => {
    if (!record) {
      return fetchLatest();
    }
    if (Date.now() - (record.updateTime ?? 0) > REVALIDATE_AFTER_MS) {
      fetchLatest().catch(() => {});
    }
    return record.lyrics;
  });
}

/**
 * 新歌速递
 * 说明 : 调用此接口 , 可获取新歌速递
 * @param {number} type - 地区类型 id, 对应以下: 全部:0 华语:7 欧美:96 日本:8 韩国:16
 */
export function topSong(type) {
  return request({
    url: '/top/song',
    method: 'get',
    params: {
      type,
    },
  });
}

/**
 * 喜欢音乐
 * 说明 : 调用此接口 , 传入音乐 id, 可喜欢该音乐
 * - id - 歌曲 id
 * - like - 默认为 true 即喜欢 , 若传 false, 则取消喜欢
 * @param {Object} params
 * @param {number} params.id
 * @param {boolean=} [params.like]
 */
export function likeATrack(params) {
  params.timestamp = new Date().getTime();
  return request({
    url: '/like',
    method: 'get',
    params,
    dedupe: false,
  });
}

/**
 * 听歌打卡
 * 说明 : 调用此接口 , 传入音乐 id, 来源 id，歌曲时间 time，更新听歌排行数据
 * - id - 歌曲 id
 * - sourceid - 歌单或专辑 id
 * - time - 歌曲播放时间,单位为秒
 * @param {Object} params
 * @param {number} params.id
 * @param {number} params.sourceid
 * @param {number=} params.time
 */
export function scrobble(params) {
  params.timestamp = new Date().getTime();
  return request({
    url: '/scrobble',
    method: 'get',
    params,
    dedupe: false,
  });
}
