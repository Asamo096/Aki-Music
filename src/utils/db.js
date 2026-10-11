import axios from 'axios';
import Dexie from 'dexie';
import store from '@/store';
// import pkg from "../../package.json";

// IndexedDB 库名。上游名为 'yesplaymusic'；本项目没有存量用户，
// 直接在开源前改名，避免把上游产品名带进用户数据路径。
const db = new Dexie('akimusic');

db.version(5).stores({
  // 歌词引擎的数据源缓存（见 src/lyrics/sources）：
  // 存**原始返回**而不是解析结果 —— 解析只要几毫秒，而解析器版本升级后
  // 缓存的原始数据仍可复用，不必让用户清缓存。
  // payload 为 null 表示「已确认该来源没有这首歌的歌词」（负缓存）。
  lyricCache: '&key, updateTime',
});

db.version(4).stores({
  trackDetail: '&id, updateTime',
  lyric: '&id, updateTime',
  album: '&id, updateTime',
});

db.version(3)
  .stores({
    trackSources: '&id, createTime',
  })
  .upgrade(tx =>
    tx
      .table('trackSources')
      .toCollection()
      .modify(
        track => !track.createTime && (track.createTime = new Date().getTime())
      )
  );

db.version(1).stores({
  trackSources: '&id',
});

let tracksCacheBytes = 0;

// 等待 settings 可用
async function waitForSettingsReady(timeoutMs = 5000) {
  const interval = 100;
  const maxTries = Math.ceil(timeoutMs / interval);
  let tries = 0;
  while (
    (store.state == null ||
      store.state.settings == null ||
      store.state.settings.cacheLimit === undefined) &&
    tries < maxTries
  ) {
    await new Promise(resolve => setTimeout(resolve, interval));
    tries++;
  }
  return store.state && store.state.settings;
}

// 初始化现有缓存总大小，确保应用启动时能正确判断并清理超限缓存
async function initTracksCacheBytes() {
  if (!process.env.IS_ELECTRON) return;
  try {
    await waitForSettingsReady();
    const all = await db.trackSources.toArray();
    tracksCacheBytes = all.reduce(
      (sum, t) => sum + (t?.source?.byteLength || 0),
      0
    );
    console.debug(
      '[debug][db.js] initTracksCacheBytes, total bytes:',
      tracksCacheBytes
    );
    deleteExcessCache();
  } catch (err) {
    console.debug('[debug][db.js] initTracksCacheBytes failed', err);
  }
}

// 模块加载时触发初始化
initTracksCacheBytes();

async function deleteExcessCache() {
  if (
    store.state.settings.cacheLimit === false ||
    tracksCacheBytes < store.state.settings.cacheLimit * Math.pow(1024, 2)
  ) {
    return;
  }
  try {
    const delCache = await db.trackSources.orderBy('createTime').first();
    await db.trackSources.delete(delCache.id);
    tracksCacheBytes -= delCache.source.byteLength;
    console.debug(
      `[debug][db.js] deleteExcessCacheSucces, track: ${delCache.name}, size: ${delCache.source.byteLength}, cacheSize:${tracksCacheBytes}`
    );
    deleteExcessCache();
  } catch (error) {
    console.debug('[debug][db.js] deleteExcessCacheFailed', error);
  }
}

/**
 * 把 CDN 资源改走本地 /proxy 同源转发。
 *
 * 渲染进程已开启 webSecurity，跨源 XHR 会被拦截；而下面的音频与封面预热
 * 都是 XHR（img/audio 标签不受影响）。转发端点与域名白名单见 src/background.js。
 *
 * data: / blob: 这类本就同源的地址原样返回。
 */
const proxied = url =>
  /^https?:/i.test(url) ? `/proxy?url=${encodeURIComponent(url)}` : url;

export function cacheTrackSource(trackInfo, url, bitRate, from = 'netease') {
  if (!process.env.IS_ELECTRON) return;
  const name = trackInfo.name;
  const artist =
    (trackInfo.ar && trackInfo.ar[0]?.name) ||
    (trackInfo.artists && trackInfo.artists[0]?.name) ||
    'Unknown';
  let cover = trackInfo.al.picUrl;
  if (cover.slice(0, 5) !== 'https') {
    cover = 'https' + cover.slice(4);
  }
  axios.get(proxied(`${cover}?param=512y512`));
  axios.get(proxied(`${cover}?param=224y224`));
  axios.get(proxied(`${cover}?param=1024y1024`));
  return axios
    .get(proxied(url), {
      responseType: 'arraybuffer',
    })
    .then(response => {
      db.trackSources.put({
        id: trackInfo.id,
        source: response.data,
        bitRate,
        from,
        name,
        artist,
        createTime: new Date().getTime(),
      });
      console.debug(`[debug][db.js] cached track 👉 ${name} by ${artist}`);
      tracksCacheBytes += response.data.byteLength;
      deleteExcessCache();
      return { trackID: trackInfo.id, source: response.data, bitRate };
    });
}

export function getTrackSource(id) {
  return db.trackSources.get(Number(id)).then(track => {
    if (!track) return null;
    console.debug(
      `[debug][db.js] get track from cache 👉 ${track.name} by ${track.artist}`
    );
    return track;
  });
}

export function cacheTrackDetail(track, privileges) {
  db.trackDetail.put({
    id: track.id,
    detail: track,
    privileges: privileges,
    updateTime: new Date().getTime(),
  });
}

export function getTrackDetailFromCache(ids) {
  return db.trackDetail
    .filter(track => {
      return ids.includes(String(track.id));
    })
    .toArray()
    .then(tracks => {
      const result = { songs: [], privileges: [] };
      ids.map(id => {
        const one = tracks.find(t => String(t.id) === id);
        result.songs.push(one?.detail);
        result.privileges.push(one?.privileges);
      });
      if (result.songs.includes(undefined)) {
        return undefined;
      }
      // 附带最新鲜度（取命中条目中最旧的一次写入时间），
      // 供调用方判断是否需要后台刷新，见 api/track.js
      result.lastUpdated = tracks.length
        ? Math.min(...tracks.map(t => t.updateTime ?? 0))
        : 0;
      return result;
    });
}

export function cacheLyric(id, lyrics) {
  db.lyric.put({
    id,
    lyrics,
    updateTime: new Date().getTime(),
  });
}

/**
 * 读取缓存的歌词。
 *
 * 返回**整条记录**（含 updateTime）而不是仅 lyrics：调用方需要用它判断
 * 缓存是否足够新鲜（见 api/track.js），避免每次调用都触发后台刷新。
 *
 * @returns {Promise<{lyrics: any, updateTime: number} | undefined>}
 */
export function getLyricFromCache(id) {
  return db.lyric.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result;
  });
}

/**
 * 歌词引擎的原始数据缓存（见 src/lyrics/sources）。
 *
 * 键形如 `amll:123456` / `yrc:123456`；存原始返回而不是解析结果，
 * 这样解析器升级后缓存仍可复用。payload 为 null 表示负缓存
 * （已确认该来源没有这首歌的歌词），避免每次进歌词页都去打听一次。
 *
 * @param {string} key
 * @returns {Promise<{key: string, payload: any, source: string, updateTime: number} | undefined>}
 */
export function getLyricCacheEntry(key) {
  return db.lyricCache.get(key);
}

export function putLyricCacheEntry(key, { payload, source }) {
  return db.lyricCache.put({
    key,
    payload,
    source,
    updateTime: new Date().getTime(),
  });
}

export function cacheAlbum(id, album) {
  db.album.put({
    id: Number(id),
    album,
    updateTime: new Date().getTime(),
  });
}

export function getAlbumFromCache(id) {
  return db.album.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result.album;
  });
}

export function countDBSize() {
  const trackSizes = [];
  return db.trackSources
    .each(track => {
      trackSizes.push(track.source.byteLength);
    })
    .then(() => {
      const res = {
        bytes: trackSizes.reduce((s1, s2) => s1 + s2, 0),
        length: trackSizes.length,
      };
      tracksCacheBytes = res.bytes;
      console.debug(
        `[debug][db.js] load tracksCacheBytes: ${tracksCacheBytes}`
      );
      return res;
    });
}

export function clearDB() {
  return new Promise(resolve => {
    db.tables.forEach(function (table) {
      table.clear();
    });
    resolve();
  });
}
