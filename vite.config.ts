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
        // 桌面开发默认走同源 /api，由下面的 dev server 代理转发到内嵌 API(10754)。
        // 开启 webSecurity 后渲染进程不能再跨源直连 10754，直连地址会失败。
        '/api'
      ),
      'process.env.VUE_APP_LASTFM_API_KEY': str('VUE_APP_LASTFM_API_KEY'),
      'process.env.VUE_APP_LASTFM_API_SHARED_SECRET': str(
        'VUE_APP_LASTFM_API_SHARED_SECRET'
      ),
      'process.env.VUE_APP_REAL_IP': str('VUE_APP_REAL_IP'),
      // 说明：这里不再需要为 process.platform 做替换。平台判断已收敛到
      // utils/platform.js，它从 preload 注入的 window.aki.platform 读取；
      // Web 构建下取不到，视作未知平台（与上游 Web 端行为一致）。
    },

    server: {
      port: Number(env.DEV_SERVER_PORT) || 8080,
      host: true,
      proxy: {
        // 桌面开发：渲染进程经开发服务器**同源**访问内嵌 API(10754)。
        // Web 开发：假设 API 服务独立运行在 3000 端口。
        '^/api': {
          target: isElectron
            ? 'http://127.0.0.1:10754'
            : 'http://localhost:3000',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/api/, ''),
        },
        // CDN 转发端点：桌面构建的音频/封面缓存要经它访问网易云 CDN
        // （webSecurity 已开启，渲染进程不能跨源）。实现见 src/background.js。
        '^/proxy': {
          target: 'http://127.0.0.1:27232',
          changeOrigin: true,
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
