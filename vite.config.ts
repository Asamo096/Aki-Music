// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, loadEnv } from 'vite';
import vue2 from '@vitejs/plugin-vue2';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig(({ command, mode }) => {
  const root = __dirname;
  // --mode electron：桌面端渲染进程构建
  const isElectron = mode === 'electron';
  const isBuild = command === 'build';

  /**
   * 读取 .env / .env.[mode]（空前缀表示不做 VITE_ 过滤）。
   *
   * 上游把这些变量放在 .env 里（已被 .gitignore 排除），本项目改为在代码中给出
   * 公开默认值：它们本来就会打进客户端产物（API 地址与 Last.fm 客户端密钥），
   * 不是机密。需要覆盖时再建 .env 即可。
   */
  const env = loadEnv(mode, root, '');
  const str = (key: string, fallback = '') =>
    JSON.stringify(env[key] ?? fallback);

  return {
    plugins: [
      vue2(),
      // PWA 只用于 Web 构建：Electron 页面由本地服务提供，不需要 service worker
      ...(isElectron
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              injectRegister: 'auto',
              manifest: {
                name: 'Aki Music',
                short_name: 'Aki Music',
                background_color: '#335eea',
                theme_color: '#ffffff00',
                icons: [
                  {
                    src: 'img/icons/android-chrome-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                  },
                  {
                    src: 'img/icons/android-chrome-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                // 音频与封面不入预缓存：体积不可控，交给运行时缓存策略
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
              },
            }),
          ]),
    ],

    resolve: {
      alias: { '@': path.resolve(root, 'src') },
      extensions: ['.ts', '.js', '.mjs', '.json', '.vue'],
    },

    /**
     * Vite 不注入 process.env（也不 polyfill Node 全局），
     * 而本项目大量代码依赖上游 webpack 时代的 `process.env.XXX` 写法，
     * 因此这里逐个显式替换。改动这些约定时需要同步本表。
     */
    define: {
      'process.env.IS_ELECTRON': isElectron ? 'true' : 'false',
      'process.env.IS_TEST': 'false',
      'process.env.BASE_URL': JSON.stringify('/'),
      'process.env.NODE_ENV': JSON.stringify(
        isBuild ? 'production' : 'development'
      ),
      'process.env.VUE_APP_NETEASE_API_URL': str(
        'VUE_APP_NETEASE_API_URL',
        '/api'
      ),
      'process.env.VUE_APP_ELECTRON_API_URL': str(
        'VUE_APP_ELECTRON_API_URL',
        '/api'
      ),
      'process.env.VUE_APP_ELECTRON_API_URL_DEV': str(
        'VUE_APP_ELECTRON_API_URL_DEV',
        'http://127.0.0.1:10754'
      ),
      'process.env.VUE_APP_LASTFM_API_KEY': str('VUE_APP_LASTFM_API_KEY'),
      'process.env.VUE_APP_LASTFM_API_SHARED_SECRET': str(
        'VUE_APP_LASTFM_API_SHARED_SECRET'
      ),
      'process.env.VUE_APP_REAL_IP': str('VUE_APP_REAL_IP'),
      // Web 构建没有 Node 的 process，而渲染进程用它判断平台（见 utils/platform.js）。
      // 桌面端**必须保留**真实的 process，否则平台判断会失真。
      ...(isElectron ? {} : { 'process.platform': JSON.stringify('') }),
    },

    server: {
      port: Number(env.DEV_SERVER_PORT) || 8080,
      host: true,
      proxy: {
        // Web 开发时假设 API 服务独立运行在 3000 端口
        '^/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/api/, ''),
        },
      },
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      // 与上游一致：产物体积优先，Electron 内不需要为老浏览器降级
      target: 'esnext',
      chunkSizeWarningLimit: 1500,
    },
  };
});
