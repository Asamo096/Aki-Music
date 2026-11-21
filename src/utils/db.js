import axios from 'axios';
import Dexie from 'dexie';
// import pkg from "../../package.json";

// IndexedDB 库名。上游名为 'yesplaymusic'；本项目没有存量用户，
// 直接在开源前改名，避免把上游产品名带进用户数据路径。
const db = new Dexie('akimusic');

db.version(7).stores({
  // 缓存元数据：只存字节数，启动统计缓存大小时不再读 1GB 级音频 Blob。
  // 旧库首次启动由 repairTrackSourceMeta() 在空闲时逐条补齐。
  trackSourceMeta: '&id',
});

db.version(6).stores({
  // 用户上传的歌词字体（M2-B）。存 Blob 本身：注册时用 FontFace 直接吃
  // ArrayBuffer，不需要文件路径，也就不需要额外的 IPC / 自定义协议。
  customFonts: '&id, createdAt',
});

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

/**
 * 读取缓存上限（MB，false = 不限制）。
 *
 * 不直接 import store：db 被 store → Player → db 的循环引用波及，
 * 模块初始化时 store 绑定尚未完成（TDZ），之前的启动日志错误就来自这里。
 * settings 的持久化是同步的（store/plugins/localStorage），读 localStorage 等价且无环。
 */
const readCacheLimit = () => {
  try {
    if (typeof localStorage === 'undefined') return 8192;
    const settings = JSON.parse(localStorage.getItem('settings'));
    return settings?.cacheLimit ?? 8192;
  } catch (error) {
    return 8192;
  }
};

let metaRepairPromise = null;

const sumMetaBytes = async () => {
  let bytes = 0;
  await db.trackSourceMeta.each(meta => {
    bytes += meta?.bytes || 0;
  });
  return bytes;
};

const scheduleIdle = task => {
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 5000 });
  } else {
    window.setTimeout(task, 3000);
  }
};

/**
 * 旧库一次性迁移：把已有 trackSources 的 byteLength 补进 trackSourceMeta。
 * 放在启动后的空闲时间执行，避免为统计 1.19GB 缓存而阻塞首页。
 */
async function repairTrackSourceMeta() {
  if (metaRepairPromise) return metaRepairPromise;
  metaRepairPromise = (async () => {
    const [sourceCount, metaCount] = await Promise.all([
      db.trackSources.count(),
      db.trackSourceMeta.count(),
    ]);
    if (metaCount >= sourceCount) return;

    let pending = [];
    await db.trackSources.each(async track => {
      pending.push({
        id: track.id,
        bytes: track?.source?.byteLength || 0,
      });
      if (pending.length >= 200) {
        const batch = pending;
        pending = [];
        await db.trackSourceMeta.bulkPut(batch);
      }
    });
    if (pending.length) await db.trackSourceMeta.bulkPut(pending);

    tracksCacheBytes = await sumMetaBytes();
    console.debug(
      '[debug][db.js] repairTrackSourceMeta done, total bytes:',
      tracksCacheBytes
    );
    deleteExcessCache();
  })()
    .catch(error => {
      console.debug('[debug][db.js] repairTrackSourceMeta failed', error);
    })
    .finally(() => {
      metaRepairPromise = null;
    });
  return metaRepairPromise;
}

// 初始化缓存总大小：只读元数据；旧库在后台逐条补表，不阻塞启动。
async function initTracksCacheBytes() {
  if (!process.env.IS_ELECTRON) return;
  try {
    tracksCacheBytes = await sumMetaBytes();
    const [sourceCount, metaCount] = await Promise.all([
      db.trackSources.count(),
      db.trackSourceMeta.count(),
    ]);
    console.debug(
      '[debug][db.js] initTracksCacheBytes, total bytes:',
      tracksCacheBytes
    );
    if (metaCount < sourceCount) {
      scheduleIdle(() => repairTrackSourceMeta());
    } else {
      deleteExcessCache();
    }
  } catch (err) {
    console.debug('[debug][db.js] initTracksCacheBytes failed', err);
  }
}

// 模块加载时触发初始化
initTracksCacheBytes();

async function deleteExcessCache() {
  const cacheLimit = readCacheLimit();
  if (
    cacheLimit === false ||
    tracksCacheBytes < Number(cacheLimit) * Math.pow(1024, 2)
  ) {
    return;
  }
  try {
    const delCache = await db.trackSources.orderBy('createTime').first();
    await db.trackSources.delete(delCache.id);
    await db.trackSourceMeta.delete(delCache.id);
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

/** 只下载字节、不做图片解码：避免把封面解码位图推进 GPU 图片缓存 */
export function prefetchCover(picUrl, signal) {
  if (!process.env.IS_ELECTRON || !picUrl) return Promise.resolve();
  let cover = picUrl;
  if (cover.slice(0, 5) !== 'https') cover = 'https' + cover.slice(4);
  return axios
    .get(proxied(`${cover}?param=224y224`), {
      responseType: 'arraybuffer',
      signal,
    })
    .then(() => undefined)
    .catch(() => undefined);
}

/** 判断音频是否已缓存（读元数据表，不读音频 Blob） */
export function hasCachedTrackSource(id) {
  return db.trackSourceMeta.get(Number(id)).then(meta => Boolean(meta));
}

export function cacheTrackSource(
  trackInfo,
  url,
  bitRate,
  from = 'netease',
  options = {}
) {
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
  // 只预热列表/播放条真正用到的 224 尺寸；512/1024 在歌词页/大图出现时
  // 由浏览器按需加载。此前一次缓存会下载三张封面，放大图片缓存与请求量。
  prefetchCover(cover, options.signal);
  return axios
    .get(proxied(url), {
      responseType: 'arraybuffer',
      signal: options.signal,
    })
    .then(response => {
      const record = {
        id: trackInfo.id,
        source: response.data,
        bitRate,
        from,
        name,
        artist,
        createTime: new Date().getTime(),
      };
      const bytes = response.data.byteLength;
      // 先读旧记录，重复缓存同一首时按差值累计，避免缓存统计虚高
      return db.trackSources.get(trackInfo.id).then(previous => {
        return db.trackSources
          .put(record)
          .then(() => db.trackSourceMeta.put({ id: trackInfo.id, bytes }))
          .then(() => {
            tracksCacheBytes += bytes - (previous?.source?.byteLength || 0);
            console.debug(
              `[debug][db.js] cached track 👉 ${name} by ${artist}`
            );
            deleteExcessCache();
            return {
              trackID: trackInfo.id,
              source: response.data,
              bitRate,
            };
          });
      });
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

export async function countDBSize() {
  const [length, metaCount] = await Promise.all([
    db.trackSources.count(),
    db.trackSourceMeta.count(),
  ]);
  // 旧库首次统计时补一次元数据；之后只读几十字节/条的 meta
  if (metaCount < length) await repairTrackSourceMeta();
  const bytes = await sumMetaBytes();
  tracksCacheBytes = bytes;
  console.debug(`[debug][db.js] load tracksCacheBytes: ${tracksCacheBytes}`);
  return { bytes, length };
}

export function clearDB() {
  return Promise.all(db.tables.map(table => table.clear())).then(() => {
    tracksCacheBytes = 0;
  });
}

/* ── 用户上传的歌词字体（M2-B，单槽：同一时间只保留一个上传字体）── */

export function saveCustomFont(record) {
  return db.customFonts.put(record);
}

/** 取最近上传的那一个（正常情况下只会有一条） */
export function getCustomFont() {
  return db.customFonts.orderBy('createdAt').last();
}

export function removeCustomFont(id) {
  return id ? db.customFonts.delete(id) : db.customFonts.clear();
}
