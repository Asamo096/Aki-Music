# Aki Music

> 一个桌面音乐播放器，基于 [YesPlayMusic](https://github.com/qier222/YesPlayMusic) 二次开发。
> 目标是保留 YesPlayMusic 完整的功能骨架，并把全屏歌词体验做到 [Folia](https://github.com/chthollyphile/folia-major) 的水准。

**项目状态：M0 / M1a / M1b 主体已完成（尚余 api-enhanced 迁移），不可对外发布。**

工具链已换成 Vite + esbuild，Electron 已升到 43，**渲染进程已沙箱化**
（无 `require`/`process`，IPC 走白名单桥，开启 `webSecurity` 并配置 CSP），
**Windows 安装包可产出**，桌面应用图标已换为自有图标。
功能代码仍是上游原样，尚不可对外发布。
后续：api-enhanced 迁移收尾 M1b，然后进入 M2（歌词引擎）。

---

## 规划中的能力

**继承自 YesPlayMusic** —— 网易云账号登录（扫码/手机/邮箱）、私人 FM、每日推荐、歌单/专辑/歌手、
MV 播放、音乐云盘、音源降级链与 UnblockNeteaseMusic 解锁、Last.fm 记录、
托盘/MPRIS/Touch Bar/全局快捷键、深浅色主题、PWA。

**本项目新增** ——

| 能力 | 来源 | 计划里程碑 |
|---|---|---|
| 逐字（卡拉 OK）歌词 | AMLL TTML 数据 + 网易云逐字接口 | M2 |
| 全屏歌词视觉模式 | 移植 Folia | M3 |
| 歌词背景风格系统（**保留现有 4 种背景** + 新增可视化） | 自研 + 移植 Folia | M2 / M3 |
| 双人「一起听」 | 移植 MiaoSIKI 的分支（裁剪多人房） | M4 |
| 请求层优化（去重、缓存分层、优先级调度） | 自研 | M1b / M2 |

## 技术栈

| 层 | 现状 | 目标 |
|---|---|---|
| 运行时 | **Node 24**（`.nvmrc`） | 同 |
| 包管理 | **pnpm 11** | 同 |
| 构建（渲染进程） | **Vite 7** + `@vitejs/plugin-vue2` | 同 |
| 构建（主进程） | **esbuild**（`scripts/build-main.mjs`，依赖外部化） | 同 |
| 框架 | **Vue 2.7.16** | Vue 3（M6） |
| 语言 | JavaScript + **渐进 TypeScript**（`allowJs`） | 全量 TS |
| 桌面 | **Electron 43.7.9**，渲染进程已沙箱化（preload + contextBridge + 白名单 IPC + CSP） | 同 |
| 打包 | **electron-builder 26**（Windows 已产出安装包） | 三平台产物（M5） |
| 后端 | 内嵌 `@neteaseapireborn/api` 4.29.7 @ `127.0.0.1:10754` | 内嵌 `api-enhanced`（M1b 收尾） |
| 测试 | 无 | Vitest + Playwright |

详细分析见 [技术栈分析](./docs/技术栈分析.md)。

## 开发

```bash
pnpm install

pnpm dev              # Web 开发（http://localhost:8080，需另起 API 在 3000 端口）
pnpm dev:electron     # 桌面开发（一条命令拉起 Vite + 主进程构建 + Electron）
                      #   可透传 Electron 参数：pnpm dev:electron -- --remote-debugging-port=9222

pnpm build            # 构建 Web 产物 → dist/
pnpm build:electron   # 构建桌面产物 → dist/（渲染）+ dist-electron/（主进程/预加载）
pnpm build:main       # 只构建主进程与预加载脚本

pnpm electron:build       # 打包当前平台安装包 → dist_electron/
pnpm electron:build:win   # 只打 Windows
pnpm electron:build:dir   # 只生成未打包目录（验证配置，最快）

pnpm typecheck        # tsc --noEmit
pnpm lint             # ESLint
pnpm prettier         # 格式化 ./src
pnpm icons            # 由 build/icon.png 生成应用图标全套 → build/icons/
```

配置文件见 [`.env.example`](./.env.example)；所有公开默认值已写在 `vite.config.ts` 里，
不建 `.env` 也能直接构建。

桌面开发时 Electron 会同时启动两个本地服务：内嵌网易云 API（`10754`）与
静态/代理服务（`27232`）。调试渲染进程可加 `--remote-debugging-port=9222`。

## 已知问题

> M1a 阶段的两项遗留状态已在 M1b 解决：Electron 二进制安装问题（升级到 43 后改为懒下载，
> 见下）与打包未启用（M1b 启用）。以下为当前状态。

**1. Electron 二进制是懒下载的（这是设计，不是故障）**

Electron 43 的 npm 包**不再声明 `postinstall`**，二进制由 `electron/index.js` 在首次
`require('electron')` 时按需下载（缓存于 `%LOCALAPPDATA%/electron/Cache`）。
因此 `pnpm install` 不会下载 Electron，首次运行 `pnpm dev:electron` 时会自动补上。

> 背景：上游的 Electron 13 依赖旧版 `extract-zip`，在 Node 24 下解压会静默失败
> （进程退出 0 但二进制没解出来），当时需要手动解压。升级到 Electron 43 后该问题不存在。

**2. 当前仍存在的稳定状态**

- **打包体积偏大（约 124 MB/安装包）**：产物内含全部 13 个平台的
  `@unblockneteasemusic/rust-napi-*` 预编译二进制（约 93 MB）。按目标平台过滤是可行的优化，
  但静态 `files` 无法按平台条件化，需要 afterPack 钩子，留待后续处理。
- **安装包只在 Windows 上验证过**：`electron-builder.yml` 已含 macOS / Linux 配置，
  但必须在对应平台上构建才能验证；安装包的**实际安装过程**（oneClick + perMachine 会写入系统
  并有 UAC 提示）留待 M5 发布前在干净环境验证。
- **Web 与桌面构建共用输出目录 `dist/`**：两者是同一个应用的两种目标，同时构建会互相覆盖。
- **ESLint 仍是 6**：能运行且已清零 error，升级到 9/Biome 安排在后续。
- **Discord Rich Presence 暂时移除**：上游依赖的 `discord-rich-presence@0.0.8` 有一个走 git 仓库解析的
  子依赖（该包已从 npm 撤下），pnpm 默认拒绝这类异源子依赖。该功能此前已停用，无功能损失；
  M5 会用 `@xhayper/discord-rpc` 重新实现。
- **`@neteaseapireborn/api` 锁定为 `4.29.7`**：该包 4.29.10 之后是 2～6 个文件的桩包，
  用 `^4.29.7` 会解析到桩包导致内嵌 API 完全不可用，因此精确锁定（M1b 将整体替换为 api-enhanced）。
- **图标只替换了应用图标**：窗口 / 任务栏 / 程序坞 / 安装包用的图标已换为自有图标
  （母图 `build/icon.png`，`pnpm icons` 生成全套）。**PWA / favicon 图标与托盘图标仍是上游资产**——
  托盘图标需要专门的简化单色设计（彩色详图缩到 16–20px 会糊），留待后续一并处理，见 NOTICE §2。

## 图标

应用图标以 `build/icon.png` 为**唯一母图**（方形、角部透明、建议 ≥1024×1024），
`pnpm icons` 生成 `build/icons/` 下的 9 个尺寸 PNG、多尺寸 `icon.ico` 与 `icon.icns`。
换图标只需替换母图再跑一次脚本。

## 文档

| 文档 | 内容 |
|---|---|
| [技术栈分析](./docs/技术栈分析.md) | 5 个仓库的技术栈现状、架构拆解、技术债与风险清单 |
| [二开计划书](./docs/二开计划书.md) | 决策记录、能力来源矩阵、目标架构、模块设计、里程碑与排期 |
| [接口清单与迁移评估](./docs/接口清单与迁移评估.md) | 124 个接口的现状排查：有无缺口、废弃接口、是否值得迁移 api-enhanced |
| [NOTICE](./NOTICE.md) | 上游署名、许可证、品牌资产状态、相对上游的修改记录 |
| [THIRD-PARTY](./THIRD-PARTY.md) | 依赖与许可证清单（M1b 完成核验） |

> `docs/` 下的两份文档随仓库一同维护；仓库内的版本为准。

## 许可证

**AGPL-3.0-or-later**，全文见 [LICENSE](./LICENSE)。

本项目以 YesPlayMusic `v0.4.11`（MIT）为基线，并用 AGPL 整体发布。
上游署名与合规记录见 [NOTICE.md](./NOTICE.md)；使用或分发前请阅读该文件，
特别是其中关于**品牌资产**与**源码提供义务**的部分。

## 致谢

- [YesPlayMusic](https://github.com/qier222/YesPlayMusic) —— 本项目的功能骨架与全部 UI 基础
- [Folia](https://github.com/chthollyphile/folia-major) —— 歌词引擎与可视化模式的实现参考与移植来源
- [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) —— 自托管的网易云 API 服务
- [amll-ttml-db](https://github.com/amll-dev/amll-ttml-db) —— 逐字歌词数据
- [YesPlayMusic-listen-together-support](https://github.com/MiaoSIKI/YesPlayMusic-listen-together-support) —— 双人「一起听」实现
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server) —— 音源解锁

本项目与网易云音乐官方无关。
