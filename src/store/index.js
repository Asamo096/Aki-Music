import Vue from 'vue';
import Vuex from 'vuex';
import state from './state';
import mutations from './mutations';
import actions from './actions';
import { changeAppearance, changeThemeColor } from '@/utils/common';
import Player from '@/utils/Player';
// vuex 自定义插件
import saveToLocalStorage from './plugins/localStorage';
import { getSendSettingsPlugin } from './plugins/sendSettings';

Vue.use(Vuex);

let plugins = [saveToLocalStorage];
if (process.env.IS_ELECTRON === true) {
  let sendSettings = getSendSettingsPlugin();
  plugins.push(sendSettings);
}
const options = {
  state,
  mutations,
  actions,
  plugins,
};

const store = new Vuex.Store(options);

if ([undefined, null].includes(store.state.settings.lang)) {
  const defaultLang = 'en';
  const langMapper = new Map()
    .set('zh', 'zh-CN')
    .set('zh-TW', 'zh-TW')
    .set('en', 'en')
    .set('tr', 'tr');
  store.state.settings.lang =
    langMapper.get(
      langMapper.has(navigator.language)
        ? navigator.language
        : navigator.language.slice(0, 2)
    ) || defaultLang;
  localStorage.setItem('settings', JSON.stringify(store.state.settings));
}

changeAppearance(store.state.settings.appearance);
changeThemeColor(store.state.settings.themeColor);

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => {
    if (store.state.settings.appearance === 'auto') {
      changeAppearance(store.state.settings.appearance);
      changeThemeColor(store.state.settings.themeColor);
    }
  });

/**
 * 副窗口（桌面歌词 / 远程控制）**不创建播放器**。
 *
 * 为什么必须跳过：Player 的 `_init()` 会从 localStorage 恢复 `_enabled=true` 并
 * `_replaceCurrentTrack()` —— 于是每个副窗口都会各自加载一路音源（表现为
 * "两个播放源"、系统媒体控制里出现多个会话、以及静音其中一路后另一路还在响）。
 * 副窗口只负责显示，播放能力只属于主窗口。
 *
 * 判定方式与渲染入口一致：URL 查询参数 `?win=...`（见 src/main.js）。
 */
const isSecondaryWindow =
  typeof window !== 'undefined' &&
  Boolean(new URLSearchParams(window.location.search).get('win'));

if (!isSecondaryWindow) {
  let player = new Player();
  player = new Proxy(player, {
    set(target, prop, val) {
      // console.log({ prop, val });
      target[prop] = val;
      if (prop === '_howler') return true;
      target.saveSelfToLocalStorage();
      target.sendSelfToIpcMain();
      return true;
    },
  });
  store.state.player = player;
}
// 副窗口保留 state.player 里的普通对象（仅用于展示字段），但没有任何播放能力

export default store;
