# NOTICE — 上游署名、许可证与合规记录

本文件记录 Aki Music 的来源、第三方权利归属与 AGPL-3.0 合规状态。
**这是一份合规文件，不是普通说明文档**：当引入新的代码来源或替换品牌资产时，请同步更新它。

| 项 | 值 |
|---|---|
| 本项目许可证 | **AGPL-3.0-or-later**（全文见 [LICENSE](./LICENSE)） |
| 基线 | YesPlayMusic `v0.4.11`（本仓库 tag `upstream-0.4.11`） |
| 产品标识 | productName `Aki Music`、appId `com.asamo.aki.player`、包名 `aki-music` |
| 依赖清单 | 见 [THIRD-PARTY.md](./THIRD-PARTY.md) |

---

## 1. 来源工程与署名

### 1.1 YesPlayMusic —— 本项目基线

- 仓库：https://github.com/qier222/YesPlayMusic
- 版本：`v0.4.11`（commit `5d5fa23`）
- 许可证：MIT（Copyright (c) 2020-2023 qier222）
- 用途：本项目以其实**全部源码**为初始基线，之后整体改以 AGPL-3.0 发布

本仓库的**首个提交**（tag `upstream-0.4.11`）是**未修改的上游源码树**，仅排除两类内容：

- `.git/`：上游提交历史（保持本项目历史干净）
- `images/`：上游的 README 截图与 logo（属于上游品牌资产，见第 2 节）

相对该基线的全部修改记录见第 3 节。

按 MIT 许可证要求，上游的版权声明与许可声明全文保留如下：

```
MIT License

Copyright (c) 2020-2023 qier222

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 1.2 folia-major —— 计划复用（**尚未引入**）

- 仓库：https://github.com/chthollyphile/folia-major
- 版本：`0.7.17`；许可证：**AGPL-3.0**
- 计划用途：M2/M3 阶段移植其歌词引擎（格式解析、字素级计时、CJK 语义布局、字级着色/发光）
  与部分可视化模式

**引入时必须遵守**：

1. 逐文件移植时**保留原文件的版权声明**（含其 AGPL 声明），并追加修改说明（格式见 1.6）
2. 引入后在本节补充**具体文件清单**
3. 不得将本项目的任何 AGPL 派生代码提交到 MIT 项目（尤其见第 3 节「防串味」）

> 当前（M0）本仓库**尚未包含任何 folia-major 代码**，因此其署名义务尚未触发；本节为先期登记。

### 1.3 api-enhanced —— 依赖

- 仓库：https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced
- 许可证：MIT（沿用上游 Binaryify/NeteaseCloudMusicApi 的 MIT 授权）
- 计划用途：M1 阶段替换内嵌的 `@neteaseapireborn/api`，提供逐字歌词（`lyric_new`）
  与双人一起听（9 个 `listentogether_*` 模块）能力
- 形态：**外部 npm 依赖，不复制其源码进本仓库**，以便随时跟进上游更新

### 1.4 YesPlayMusic-listen-together-support —— 计划复用（**尚未引入**）

- 仓库：https://github.com/MiaoSIKI/YesPlayMusic-listen-together-support
- 许可证：MIT
- 计划用途：M4 阶段移植双人「一起听」的业务逻辑与面板 UI（裁剪掉多人房部分）

### 1.5 amll-ttml-db —— 运行时数据源

- 仓库：https://github.com/amll-dev/amll-ttml-db
- 许可证：社区创作部分 CC0 1.0
- 使用方式：**运行时通过其官方 HTTP API 消费**逐字歌词数据，**不复制、不再分发**该数据库
- 注意：歌词内容本身的权利归各平台与原作者，因此本项目不自建镜像、不再分发数据

### 1.6 修改说明的书写格式（AGPL §5 要求）

从任何上游移植的文件，其文件头须保留原版权声明并注明修改，例如：

```js
// Copyright (C) 2026 chthollyphile  (folia-major, AGPL-3.0)
// Modified for Aki Music on 2026-XX-XX: <一句话说明改了什么>
// SPDX-License-Identifier: AGPL-3.0-or-later
```

---

## 2. 品牌资产（⚠ 对外分发前必须处理）

AGPL 是**版权**许可，**不授予商标权**。下列资产继承自上游，属于他人的品牌资产，
在本项目拥有自己的资产之前**不得对外分发**：

| 资产 | 路径 | 状态 |
|---|---|---|
| **应用图标**（各尺寸 PNG + ico/icns） | `build/icons/*`（母图 `build/icon.png`） | ✅ **已替换为自有图标**（由 `pnpm icons` 生成） |
| PWA / favicon 图标 | `public/img/icons/`（`favicon-*`、`apple-touch-icon*`、`mstile-*`、`android-chrome-*`、`icon.ico`、`icon.icns`、`safari-pinned-tab.svg`） | ⚠ 上游资产，待替换 |
| 托盘图标 | `public/img/icons/menu-{dark,light}@88.png` | ⚠ 上游资产，待替换（需要简化单色设计，不宜直接用彩色应用图标） |
| 托盘图标残件（未被引用） | `build/icons/menu@88.png` | ⚠ 上游资产，可与托盘图标一并清理 |
| 上游 logo 与 README 截图 | `images/` | ✅ 已排除，未纳入本仓库 |
| 登录页 / Last.fm 回调页 logo | `public/img/logos/aki-music.svg` | ✅ 已替换为自有占位字标 |
| Linux 标题栏标记 | `public/img/logos/aki-mark-white.svg` | ✅ 已替换为自有占位标记 |
| 第三方图标（网易云 / Last.fm / nyancat） | `public/img/logos/{netease-music,lastfm,nyancat*}.*` | 属各自权利人，仅用于指向对应服务，保留 |

**应用图标的重生成方式**：把新母图放到 `build/icon.png`（方形、角部透明、建议 ≥1024×1024），
执行 `pnpm icons` 即可生成 `build/icons/` 全套（16×16 … 1024×1024 PNG、多尺寸 `icon.ico`、
`icon.icns`）。脚本见 `scripts/generate-icons.mjs`，取代了上游的 `electron-icon-builder`
（后者依赖的 sharp 0.29 与 phantomjs-prebuilt 在 Node 24 下装不上）。

**范围说明**：本次只替换了**应用图标**（窗口 / 任务栏 / 程序坞 / 安装包）。
PWA 与 favicon 图标、托盘图标属独立资产，仍为上游资产——托盘图标尤其需要专门的
简化单色设计，建议在 M5「品牌全套」与 PWA/favicon 一并完成。

---

## 3. 相对上游基线（`upstream-0.4.11`）的修改记录

> AGPL §5 要求标注修改。本节按里程碑追加，请勿删除历史条目。

### M0 · 立项与合规基线（2026-10-11）

**许可证与元数据**

- `LICENSE`：MIT → **AGPL-3.0**（上游 MIT 全文保留于本文件 §1.1）
- `package.json`：`name` `yesplaymusic`→`aki-music`、`version` `0.4.11`→`0.1.0`；
  新增 `license: AGPL-3.0-or-later`；更新 `description` / `author`；
  移除已不再使用的 `vue-gtag` 依赖与 `electron:publish` 脚本
- `vue.config.js`：新增 `appId: com.asamo.aki.player`；productName 与 copyright 改为 Aki Music；
  新增 `artifactName: aki-music-${os}-${version}-${arch}.${ext}`；
  新增 Linux `executableName: aki-music`（避免可执行文件名带空格）；
  **移除 `publish` 配置**——上游指向 `qier222/YesPlayMusic`，沿用会把本项目的安装包上传到**上游的 Release**

**品牌**

- 新增 `src/config/app.js`：产品名与对外链接的**单一来源**
  （`PRODUCT_NAME` / `REPO_URL` / `RELEASES_URL` / `DISCORD_APP_ID`）
- 用户可见产品名统一为 Aki Music：窗口标题、托盘 tooltip、MPRIS identity、Touch Bar、
  应用菜单、Discord 通知文案、`store.state.title`
- 登录页、Last.fm 回调页、Linux 标题栏：上游 logo → 自有占位 SVG
  （新增 `public/img/logos/aki-music.svg`、`aki-mark-white.svg`；
  删除 `public/img/logos/yesplaymusic.png`、`yesplaymusic-white24x24.png`）
- `src/locale/lang/{zh-CN,zh-TW,en,tr}.js`：登录页隐私说明改为 Aki Music，**移除指向上游仓库的链接**
- GitHub 入口（导航栏、帮助菜单）：改为读取 `REPO_URL`，**未配置时自动隐藏**，不再指向上游

**隐私**

- **移除 Google Analytics**：上游在 `src/main.js` 接入 `vue-gtag`（id `G-KMJJCFZDKF`）；
  本项目不向任何第三方统计服务上报使用数据，已删除接入代码与依赖声明
- **Discord Rich Presence**：上游硬编码使用其自有 Discord 应用 ID（会让本项目用户在 Discord 上
  显示为上游产品）；改为读取 `DISCORD_APP_ID`，**当前留空 ⇒ 整条链路停用**
- **自动更新检查**：上游会引导用户前往*上游*的 Release 下载安装包；
  改为在 `RELEASES_URL` 未配置时停用（发布源在 M5 配置）

**存储**

- IndexedDB 库名 `yesplaymusic` → `akimusic`（`src/utils/db.js`、`src/main.js`）。
  本项目尚无存量用户，此时改名成本最低

**有意保留的上游标识符**（非用户可见；改动会带来兼容风险，故保留并在此登记）

- `window.yesplaymusic` 全局对象——渲染进程与主进程的 `/player` 状态接口都依赖它
- MPRIS D-Bus 名 `org.mpris.MediaPlayer2.yesplaymusic`——OSDLyrics 等外部工具可能按此名称匹配播放器

**设置页页脚**

- `src/views/settings.vue`：页脚由「MADE BY QIER222」改为 Aki Music
  （配置 `REPO_URL` 后带链接），并保留一行「基于 YesPlayMusic 二次开发」的署名

**移除的上游基础设施**

| 移除项 | 原因 |
|---|---|
| `install-replit.sh` | 其作用是从 GitHub **克隆上游 YesPlayMusic** 来构建部署，对本发明会部署出错误的产品（Replit 部署在 M5 重写） |
| `.github/workflows/build.yaml` | 上游的发布工作流，会把安装包发布到 `qier222/YesPlayMusic` 的 Release |
| `.github/workflows/sync.yml` | fork 同步工作流，会把上游提交自动合入本仓库（上游已冻结；且 MIT↔AGPL 双向混流会造成许可证问题） |
| `.github/ISSUE_TEMPLATE/----------.md` | 内容指向上游的 issue 与 Todo 看板 |

- `docker-compose.yml`：服务名 / 镜像名 / 容器名 `YesPlayMusic` → `AkiMusic` / `aki-music`
- `.github/workflows/ci.yml`（新增）：仅做构建冒烟与 SPDX 检查，**不发布任何产物**

### M1a · 构建链升级（2026-10-11）

**工具链**

- 构建器：`@vue/cli-service`（Webpack 4）→ **Vite 7**
  - 删除 `vue.config.js` / `babel.config.js` / `jsconfig.json` / `public/index.html`
  - 新增 `vite.config.ts` 与根级 `index.html`
  - SVG 图标：上游用 webpack 专有的 `require.context` + `svg-sprite-loader`，
    改为 `import.meta.glob` 在运行时拼 sprite（`src/assets/icons/index.js`）；`SvgIcon.vue` 无需改动
  - PWA：`@vue/cli-plugin-pwa` → `vite-plugin-pwa`；Service Worker 由插件注入，
    删除 `src/registerServiceWorker.js`；**PWA 仅对 Web 目标启用**，桌面构建不含 SW
- 主进程构建：`vue-cli-plugin-electron-builder` → **esbuild**（`scripts/build-main.mjs`，依赖全部外部化）
- 运行时与包管理：Node 14/16 → **Node 24**；yarn → **pnpm 11**
- 框架：Vue 2.6.11 → **2.7.16**
- 语言：引入 **TypeScript 5.9**（渐进，`allowJs`），`src/config/app.js` 改为 `app.ts`
- 新增脚本：`dev` / `dev:electron` / `build` / `build:electron` / `build:main` / `typecheck`

**`process.env` 的处理（新增代码时必须遵守的约定）**

Vite 不注入 `process.env`，也不 polyfill Node 全局，而上游代码大量依赖这两者。
`vite.config.ts` 的 `define` 表中逐个显式替换；**新增对 `process.env.X` 的引用时必须同步该表**：

| 变量 | Web 构建 | 桌面渲染进程 |
|---|---|---|
| `process.env.IS_ELECTRON` | `false` | `true` |
| `process.env.NODE_ENV` | 按命令 | 按命令 |
| `process.env.VUE_APP_*` | 取自 env 或代码内默认值 | 同 |
| `process.platform` | 替换为 `''`（无 Node 环境） | **保留真实值**（平台判断依赖它） |

**移除的 webpack 魔法与上游遗留**

| 项 | 处理 |
|---|---|
| `__static`（webpack 注入的静态目录全局） | 改为显式模块 `src/electron/staticDir.js`；顺带让 Touch Bar 只在 macOS 上创建 |
| `createProtocol('app')` 与 `app://` 特权协议 | 移除——渲染产物一直由本地 express（27232）提供，自定义协议是冗余的 |
| `express.static(__dirname + '/')` | 改为指向渲染产物目录 `../dist` |
| `checkAuthToken` 的默认导入 | 该模块**没有任何导出**（纯副作用），上游靠 webpack 宽松的 ES 互操作才成立；改为副作用导入 |
| `meta[name=theme-color]` | 上游由 `@vue/cli-plugin-pwa` 在构建期注入（模板里没有）；迁移后在 `index.html` 显式声明——缺失会让应用启动即崩溃，同时让 `changeAppearance()` 对缺失免疫 |
| 未使用的函数参数（`background.js` / `ipcMain.js`） | 移除，使 `pnpm lint` 无 error |

**依赖变更**

- 移除：`@vue/cli-*`、`vue-cli-plugin-electron-builder`、`vue-template-compiler`、`core-js`、
  `esbuild-loader`、`svg-sprite-loader`、`register-service-worker`、
  **`discord-rich-presence`**（其子依赖经 git 仓库解析，属供应链风险，见 README 已知问题）
- 新增：`vite`、`@vitejs/plugin-vue2`、`vite-plugin-pwa`、`typescript`、`@types/node`、
  `sass`（升级）、`dbus-next`（本仓库直接导入，pnpm 严格布局下必须显式声明）
- 锁定：`@neteaseapireborn/api` 由 `^4.29.7` 改为精确 `4.29.7`（4.29.10 之后是桩包，会导致内嵌 API 完全不可用）
- 新增 `pnpm-workspace.yaml`（pnpm 11 的设置位置，只放行 electron/esbuild 的安装脚本）；
  新增 `electron-builder.yml`（从已删除的 `vue.config.js` 提取，**M1b 才启用**）；
  删除 `yarn.lock`（改用 pnpm），新增 `pnpm-lock.yaml`

**CI**

- `ci.yml` 改为 Node 24 + pnpm，增加 typecheck 与 lint；仍**不发布任何产物**

### M1a 补充 · 应用图标替换（2026-10-11）

- `build/icon.png` 换为自有母图（1536×1536，角部透明的方形图标）
- `build/icons/` 全套由 `pnpm icons` 重新生成：9 个尺寸 PNG、多尺寸 `icon.ico`（7 个 BMP 条目）、
  `icon.icns`（含 ic07–ic14 现代尺寸与 il32/is32 传统回退块）
- 删除 `build/icons/icon.png`（旧的 1024 上游图标，无任何引用）
- 新增 `scripts/generate-icons.mjs`，取代 `electron-icon-builder`；
  后者连同其依赖（sharp 0.29、phantomjs-prebuilt、icon-gen）一并从依赖树移除
- 新增开发依赖：`sharp`、`png-to-ico`、`png2icons`
- `electron-builder.yml`：Linux 图标由 `build/icons/icon.icns`（上游笔误，Linux 用不了 icns）
  改为 PNG 尺寸目录 `build/icons/`；mac 补上 `icon: build/icons/icon.icns`
- `pnpm-workspace.yaml`：移除已离开依赖树的 `phantomjs-prebuilt` 条目

### M1b · Electron 升级（2026-10-11）

**升级**

- Electron 13.6.7 → **43.7.9**（内置 Node 24.21.0）；主进程构建目标 `node14` → `node22`
- electron-builder `^23.0.0` → `^26.15.3`；electron-updater `^5.0.1` → `^6.8.9`
- electron-devtools-installer `^3.2` → `^4.0.0`
- `pnpm-workspace.yaml`：移除 electron-builder 与 icon-gen 的 overrides（其消费者已先后离开依赖树）
- 同步移除 **6 个从未被使用的死依赖**：`electron-context-menu`、`electron-debug`、
  `electron-log`、`electron-is-dev`、`extract-zip`、`music-metadata`（后两者在 `src/` 中零引用）

**Electron 43 的安装模型变化（重要，勿再按旧认知排查）**

Electron 43 的 npm 包**不再声明 `postinstall`**，二进制改由 `electron/index.js` 在首次
`require('electron')` 时**懒下载**。因此：

- `pnpm install` 不下载 Electron，是正常行为
- `pnpm rebuild electron` 不会有任何动作（没有脚本可跑）
- 首次 `pnpm dev:electron` 会自动补上二进制（缓存于 `%LOCALAPPDATA%/electron/Cache`）

上游 Electron 13 依赖旧版 `extract-zip`、在 Node 24 下解压静默失败的问题随之消失
（新版使用 `@electron-internal/extract-zip`）。

**验证**

- Electron 43 + 旧（不安全）配置下应用完整运行：内嵌 API（10754）、静态服务（27232）、
  Vue 挂载、36 个 SVG symbol、播放器单例、渲染进程零错误
- **原生模块通过**：`initIpcMain` 在启动时同步执行 `new UNM.Executor()`（rust-napi）未报错
  ——风险 R1 的关键未知数解决
- 此阶段渲染进程**仍可访问 `require` 与 `process`**（旧配置尚未拆除），安全改造为下一步

### M1b · 渲染进程沙箱化与启用打包（2026-10-11）

**安全模型（拆掉 nodeIntegration:true + contextIsolation:false + webSecurity:false）**

- 新增 `src/preload.js`：contextBridge 暴露 `window.aki`，IPC 按**通道白名单**放行
  （23 send / 1 invoke / 16 on，与主进程 ipcMain 注册一一对应）；
  `on` 回调不透出 IpcRendererEvent，改传空对象占位，故 16 处既有回调签名无需改动
- 新增 `src/utils/electronBridge.js`：渲染进程访问桥的统一入口，取代 8 处 `window.require`
- last.fm 登录窗口改用 `setWindowOpenHandler`（`new-window` 事件在 Electron 22 已移除）；
  该窗口加载远端页面，故不挂载 preload 且保持 `sandbox: true`
- 平台判断收敛到 `utils/platform.js`（优先 `window.aki.platform`，主进程回退 `process.platform`），
  因不再出现字面量 `process.platform`，vite.config 中该变量的 define 已删除
- 新增 CSP（仅非开发模式；开发模式 HMR 需要更宽松策略）

**webSecurity 开启的连锁处理（不做会导致音频缓存静默失效）**

- 新增本地 `/proxy` 转发端点（27232）：域名白名单（`*.music.126.net`、`*.bilivideo.com`）
  + Range 透传 + 流式转发；非白名单一律 403（含本地自指，防 SSRF 循环）
- `utils/db.js` 的音频与封面预热改经 `/proxy`（`data:`/`blob:` 原样放行）
- 桌面开发的 API 地址由跨源的 `http://127.0.0.1:10754` 改为同源 `/api`，由 dev server 代理转发

**启用打包**

- `electron-builder.yml` 生效；新增脚本 `electron:build` / `electron:build:win` / `electron:build:dir`
- `files` 显式声明 `dist/**`、`dist-electron/**`、`package.json`（依赖由 electron-builder
  按 dependencies 自动收集——主进程采用依赖外部化策略）
- `asarUnpack: ['**/*.node']`：原生扩展不能从 asar 内加载
- `npmRebuild: false`：原生依赖均有现成产物或可安全缺失（详见配置内注释）
- `package.json`：`electron` 与 `electron-builder` 由 dependencies 移入 devDependencies

**打包中修掉的配置缺陷（上游遗留或版本演进所致）**

| 问题 | 处理 |
|---|---|
| `electron` / `electron-builder` 放在 dependencies | electron-builder 26 直接报错拒绝；移入 devDependencies |
| `win.publisherName` 顶层字段 | electron-builder 26 已移除该位置，迁至 `win.signtoolOptions.publisherName` |
| nsis 与 portable 扩展名都是 .exe，共用顶层 `artifactName` 会互相覆盖 | 分别设置 `nsis.artifactName`（-setup）与 `portable.artifactName`（-portable） |
| `abstract-socket` 在 Windows 上编译直接 `#error "Only Linux is supported"`，导致打包中断 | `npmRebuild: false`；它是 dbus-next 的**可选**依赖且仅支持 Linux，缺失时自动降级 |
| 产物塞入全部 13 个平台的 rust-napi 预编译二进制（约 93 MB） | 记为体积优化待办（需 afterPack 钩子，静态配置无法按平台条件化） |

**验证**

- `--dir` 与完整安装包两条路径跑通：`aki-music-0.1.0-setup.exe`（124.2 MB，NSIS）、
  `aki-music-0.1.0-portable.exe`（124.0 MB）
- **安全模型在三种模式下均验证**（生产本地服务 / 开发 Vite / 打包版）：渲染进程
  `require`、`process`、`Buffer` 全部不可用；`window.aki` 可用且 platform=win32；功能完好零异常。
  打包版零错误零警告（Electron 安全警告在 `app.isPackaged` 为 true 后不再出现）
- `/proxy`：非白名单 403（含本地自指）；白名单 CDN 封面经其取回 200 / image-jpg
- **图标端到端验证**：从 `setup.exe` 提取出的图标确认为自有图标；三个可执行文件元数据均为
  ProductName=Aki Music / FileVersion=0.1.0 / Company=Asamo096
- **未验证**：安装包的实际安装过程（留待 M5 在干净环境验证）；macOS / Linux 产物需在对应平台构建

---

## 4. 待办（阻塞对外发布）

| # | 事项 | 位置 | 里程碑 |
|---|---|---|---|
| 1 | 替换剩余上游图标资产：**PWA / favicon 图标与托盘图标**（应用图标已完成，见第 2 节） | `public/img/icons/`、`build/icons/menu@88.png` | M5 |
| 2 | 填写对外仓库地址 `REPO_URL` | `src/config/app.js` | 有远程仓库后 |
| 3 | 注册本项目 Discord 应用并填 `DISCORD_APP_ID` | `src/config/app.js` | M5 |
| 4 | 配置 electron-builder 发布源（本项目自己的仓库） | `vue.config.js` | M5 |
| 5 | 发布页/关于页提供**源码获取入口**（AGPL §13 网络条款） | 关于页、README | M5 |
| 6 | 依赖许可证逐项核验（与 AGPL 的兼容性） | `THIRD-PARTY.md` | M1 |

---

## 5. 防串味规则（内部协作约束）

本仓库含 AGPL 代码后，必须避免代码反向污染宽松许可的上游项目：

| 方向 | 规则 |
|---|---|
| 从 YesPlayMusic / listen-together fork（MIT）→ 本项目 | ✅ 允许（MIT → AGPL 单向兼容） |
| 从 folia-major（AGPL）→ 本项目 | ✅ 允许，但**必须**保留原版权头 + 修改说明 |
| 本项目 → YesPlayMusic / listen-together fork（MIT） | ❌ 不发 PR；若必须回馈，需 clean-room 重写 |
| 本项目 → api-enhanced（MIT） | ❌ **绝不**提交任何源自 folia-major 的代码 |
| 第三方 npm 依赖 | ✅ 允许，但须登记于 `THIRD-PARTY.md` 并确认与 AGPL 兼容 |
