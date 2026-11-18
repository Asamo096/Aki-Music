import Vue from 'vue';
import App from './App.vue';
import router from './router';
import store from './store';
import i18n from '@/locale';
import '@/assets/icons';
import '@/utils/filters';
// Service Worker 改由 vite-plugin-pwa 在 Web 构建时自动注入
// （Electron 构建不启用 PWA，见 vite.config.ts）
import { dailyTask } from '@/utils/common';
import '@/assets/css/global.scss';
import NProgress from 'nprogress';
import '@/assets/css/nprogress.css';

window.resetApp = () => {
  localStorage.clear();
  indexedDB.deleteDatabase('akimusic');
  document.cookie.split(';').forEach(function (c) {
    document.cookie = c
      .replace(/^ +/, '')
      .replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
  });
  return '已重置应用，请刷新页面（按Ctrl/Command + R）';
};
console.log(
  '如出现问题，可尝试在本页输入 %cresetApp()%c 然后按回车重置应用。',
  'background: #eaeffd;color:#335eea;padding: 4px 6px;border-radius:3px;',
  'background:unset;color:unset;'
);

// 上游在此处接入 Google Analytics（vue-gtag, id G-KMJJCFZDKF）。
// 本项目不向任何第三方统计服务上报使用数据，故直接移除。
Vue.config.productionTip = false;

NProgress.configure({ showSpinner: false, trickleSpeed: 100 });
dailyTask();

// 副窗口（桌面歌词 / 远程控制）用查询参数区分：它们只挂一个轻量根组件，
// 不初始化路由与主界面，避免把整套应用再加载一遍。
const windowRole = new URLSearchParams(window.location.search).get('win');

if (windowRole === 'remote') {
  document.documentElement.classList.add('is-remote-control');
  const RemoteControl = () => import('@/views/remoteControl.vue');
  new Vue({
    i18n,
    store,
    render: h => h(RemoteControl),
  }).$mount('#app');
} else if (windowRole === 'desktop-lyrics') {
  document.documentElement.classList.add('is-desktop-lyrics');
  const DesktopLyrics = () => import('@/views/desktopLyrics.vue');
  new Vue({
    i18n,
    store,
    render: h => h(DesktopLyrics),
  }).$mount('#app');
} else {
  new Vue({
    i18n,
    store,
    router,
    render: h => h(App),
  }).$mount('#app');
}
