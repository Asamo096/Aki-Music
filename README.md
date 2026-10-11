# Aki Music

> 一个桌面音乐播放器，基于 [YesPlayMusic](https://github.com/qier222/YesPlayMusic) 二次开发。
> 目标是保留 YesPlayMusic 完整的功能骨架，并把全屏歌词体验做到 [Folia](https://github.com/chthollyphile/folia-major) 的水准。

**项目状态：M0（立项与合规基线）已完成，尚不可用。**
当前仓库是打好地基的空壳：许可证、品牌、元数据、CI 就位，功能代码仍是上游原样。
接下来按 [二开计划书](./docs/二开计划书.md) 的里程碑推进。

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
| 请求层优化（去重、缓存分层、优先级调度） | 自研 | M1 / M2 |

## 技术栈

| 层 | 现状（M0，继承上游） | 目标（M1 起） |
|---|---|---|
| 运行时 | Node `14 \|\| 16` | Node 22 LTS |
| 构建 | Webpack 4（`@vue/cli-service` 4.5） | Vite |
| 框架 | Vue 2.6（Options API） | Vue 2.7 → Vue 3 |
| 语言 | JavaScript（JSDoc 提示） | 渐进 TypeScript |
| 桌面 | Electron 13.6.7 | Electron 43.7.5 |
| 包管理 | yarn | pnpm |
| 后端 | 内嵌 `@neteaseapireborn/api` 于 `127.0.0.1:10754` | 内嵌 `api-enhanced` |

详细分析见 [技术栈分析](./docs/技术栈分析.md)。

## 开发

> ⚠ **当前仍使用上游的旧工具链**，需要 Node 14 或 16。用更高版本的 Node
> 运行 Webpack 4 很可能因 OpenSSL 报错，可临时加 `NODE_OPTIONS=--openssl-legacy-provider`。
> M1a 会切换到 Node 22 + Vite，届时本节将重写。

```bash
yarn install

yarn serve            # Web 开发（默认 http://localhost:8080）
yarn electron:serve   # 桌面开发（同时启动内嵌 API 与本地服务）
yarn build            # 构建 Web 产物
yarn electron:build   # 打包当前平台的桌面安装包
yarn lint             # ESLint
```

配置文件见 [`.env.example`](./.env.example)。

## 文档

| 文档 | 内容 |
|---|---|
| [技术栈分析](./docs/技术栈分析.md) | 5 个仓库的技术栈现状、架构拆解、技术债与风险清单 |
| [二开计划书](./docs/二开计划书.md) | 决策记录、能力来源矩阵、目标架构、模块设计、里程碑与排期 |
| [NOTICE](./NOTICE.md) | 上游署名、许可证、品牌资产状态、相对上游的修改记录 |
| [THIRD-PARTY](./THIRD-PARTY.md) | 依赖与许可证清单（M1 完成核验） |

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
