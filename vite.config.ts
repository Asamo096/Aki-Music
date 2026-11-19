// SPDX-License-Identifier: AGPL-3.0-or-later
// defineConfig 取自 vitest/config：它是 vite 的超集，额外支持下面的 `test` 段，
// 这样单测与应用构建共用同一份配置（resolve.alias 等），不必维护第二份。
// 注意 loadEnv 只从 vite 导出，vitest/config 没有转发它。
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import vue2 from '@vitejs/plugin-vue2';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { createRequire } from 'node:module';


/**
 * 构建期断言：渲染产物里不能出现 Vue 的开发版。
 *
 * 为什么需要：Vue 2.7 的开发版会在 getTagNamespace / isReservedTag 里对 tag 调
 * toLowerCase()，一旦某次渲染传进 undefined 就会抛
 * "Cannot read properties of undefined (reading 'toLowerCase')"；
 * 生产版这两个函数是空实现，不可能抛。我们曾在一个混入开发版 Vue 的打包产物里
 * 看到过这条报错（bundle 里能查到真实的 getTagNamespace 实现），因此在这里兜底：
 * 谁把 NODE_ENV 弄错，构建直接失败，而不是发出一个带开发期断言的包。
 */
const assertProductionVue = () => ({
  name: 'aki-assert-production-vue',
  apply: 'build' as const,
  // 用 ThisType 声明 rollup 的上下文（this.error 才是类型安全的报错方式）
  generateBundle(
    this: { error: (message: string) => never },
    _options: unknown,
    bundle: Record<string, any>
  ) {
    for (const file of Object.values(bundle)) {
      if (!file || file.type !== 'chunk' || typeof file.code !== 'string') continue;
      if (file.code.includes('You are running Vue in development mode')) {
        this.error(
          '构建产物包含 Vue 开发版（renderer 会带开发期断言，可能抛 getTagNamespace(undefined) 之类的错误）。' +
            '请检查 vite.config.ts 的 define 里 process.env.NODE_ENV 是否为 production。'
        );
      }
    }
  },
});

const require = createRequire(import.meta.url);

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
      assertProductionVue(),
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
      alias: {
        '@': path.resolve(root, 'src'),
        // 单一 Vue：CJS 依赖（如 slider 的 common 构建 require('vue')）也解析到同一份
        // ESM 运行时，否则产物里会同时出现 ESM 与 CJS 两个 Vue（各自一套 config）。
        'vue': require.resolve('vue/dist/vue.runtime.esm.js'),
        /**
         * vue-slider-component 的 package.json 只有 `main` 指向 **UMD 预打包版**
         * （dist/vue-slider-component.umd.min.js），而那个 bundle 里**内联了一份
         * 精简版 Vue 运行时**：产物里因此出现两份 Vue（两份 config / 两套运行时），
         * 其内联那份的 _createElement 调用 config.getTagNamespace() 时缺少参数，
         * 一旦渲染到 undefined tag 就抛
         * "Cannot read properties of undefined (reading 'toLowerCase')"（实测复现）。
         *
         * 指向 webpack 的 common.js 构建：它把 vue 标为 external（require('vue')），
         * 配合下面的 dedupe 保证整个应用只有一份 Vue。
         */
        'vue-slider-component': require.resolve(
          'vue-slider-component/dist/vue-slider-component.common.js'
        ),
      },
      // 依赖里所有对 'vue' 的引用都解析到同一份（避免再出现第二份运行时）
      dedupe: ['vue'],
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

    // 单测（`pnpm test`）。
    // 覆盖面刻意保守：只测不依赖浏览器/DOM 的核心逻辑——歌词解析、请求去重、
    // 可播放性判断。播放器、路由、组件等留给后续的 Playwright 冒烟。
    test: {
      environment: 'node',
      include: ['test/unit/**/*.spec.js'],
      globals: false,
      // 注入 DOMParser 等 Node 缺失的浏览器全局（TTML 解析器需要）
      setupFiles: ['test/setup.js'],
    },
  };
});
