import router from '@/router';
import { doLogout, getCookie } from '@/utils/auth';
import requestScheduler from '@/net/requestScheduler';
import axios from 'axios';

let baseURL = '';
// Web 和 Electron 跑在不同端口避免同时启动时冲突
if (process.env.IS_ELECTRON) {
  if (process.env.NODE_ENV === 'production') {
    baseURL = process.env.VUE_APP_ELECTRON_API_URL;
  } else {
    baseURL = process.env.VUE_APP_ELECTRON_API_URL_DEV;
  }
} else {
  baseURL = process.env.VUE_APP_NETEASE_API_URL;
}

const service = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 15000,
});

service.interceptors.request.use(function (config) {
  if (!config.params) config.params = {};
  if (baseURL.length) {
    if (
      baseURL[0] !== '/' &&
      !process.env.IS_ELECTRON &&
      getCookie('MUSIC_U') !== null
    ) {
      config.params.cookie = `MUSIC_U=${getCookie('MUSIC_U')};`;
    }
  } else {
    console.error("You must set up the baseURL in the service's config");
  }

  if (!process.env.IS_ELECTRON && !config.url.includes('/login')) {
    config.params.realIP = '211.161.244.70';
  }

  // Force real_ip
  const enableRealIP = JSON.parse(
    localStorage.getItem('settings')
  ).enableRealIP;
  const realIP = JSON.parse(localStorage.getItem('settings')).realIP;
  if (process.env.VUE_APP_REAL_IP) {
    config.params.realIP = process.env.VUE_APP_REAL_IP;
  } else if (enableRealIP) {
    config.params.realIP = realIP;
  }

  const proxy = JSON.parse(localStorage.getItem('settings')).proxyConfig;
  if (['HTTP', 'HTTPS'].includes(proxy.protocol)) {
    config.params.proxy = `${proxy.protocol}://${proxy.server}:${proxy.port}`;
  }

  return config;
});

service.interceptors.response.use(
  response => {
    const res = response.data;
    return res;
  },
  async error => {
    /** @type {import('axios').AxiosResponse | null} */
    let response;
    let data;
    if (error === 'TypeError: baseURL is undefined') {
      response = error;
      data = error;
      console.error("You must set up the baseURL in the service's config");
    } else if (error.response) {
      response = error.response;
      data = response.data;
    }

    if (
      response &&
      typeof data === 'object' &&
      data.code === 301 &&
      data.msg === '需要登录'
    ) {
      console.warn('Token has expired. Logout now!');

      // 登出帳戶
      doLogout();

      // 導向登入頁面
      if (process.env.IS_ELECTRON === true) {
        router.push({ name: 'loginAccount' });
      } else {
        router.push({ name: 'login' });
      }
    }
  }
);

/** 稳定序列化：对象键排序、数组排序，保证「语义相同」生成同一个 key */
const stableValue = value => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).sort().join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${key}:${stableValue(value[key])}`)
      .join(',')}}`;
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
};

export const buildRequestKey = config =>
  `${(config.method || 'get').toLowerCase()}:${config.url}:${stableValue(
    config.params
  )}:${stableValue(config.data)}`;

const P0_PREFIXES = ['/song/url', '/song/detail', '/lyric'];

/**
 * 优先级推断：播放关键路径 P0，其余页面请求 P1。
 * 预取/后台任务由调用方显式传 P2/P3。
 */
export const inferRequestPriority = config => {
  const url = String(config.url || '');
  const uri = String(config.params?.uri || '');
  if (P0_PREFIXES.some(prefix => url.startsWith(prefix))) return 'P0';
  if (uri.includes('/cloud/lyric')) return 'P0';
  return 'P1';
};

/**
 * 统一入口：调度 + 去重 + 取消。
 *
 * config 额外支持（不会传给 axios）：
 *   priority   'P0'..'P3'
 *   signal     AbortSignal，只取消当前调用方
 *   group      作用域标签（requestScheduler.cancelGroup）
 *   dedupe     false 可跳过并发去重（写请求）
 *   dedupeKey  调用方自定义归一化 key
 */
const request = config => {
  const { priority, signal, group, dedupe, dedupeKey, ...axiosConfig } =
    config || {};
  const method = (axiosConfig.method || 'get').toLowerCase();
  return requestScheduler.schedule({
    key: dedupeKey || buildRequestKey(axiosConfig),
    priority: priority || inferRequestPriority(axiosConfig),
    signal,
    group,
    // 默认只对读请求去重；写请求即使 URL 相同也不应共享结果
    dedupe: dedupe === undefined ? method === 'get' : dedupe,
    run: taskSignal => service({ ...axiosConfig, signal: taskSignal }),
  });
};

// 保留 axios 实例的方法/配置（目前调用方只用可调用形式，防止未来用到）
Object.assign(request, service);

// 调试/验收：观察队列与在途请求（不承载业务逻辑）
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__akiRequestScheduler', {
    value: requestScheduler,
    configurable: true,
  });
}

export { service };
export default request;
