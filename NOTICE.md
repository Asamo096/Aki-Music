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
| 应用图标（各尺寸 + ico/icns） | `build/icons/*` | ⚠ 上游资产，待替换 |
| PWA / favicon 图标 | `public/img/icons/`（`favicon-*`、`apple-touch-icon*`、`mstile-*`、`android-chrome-*`、`icon.ico`、`icon.icns`、`safari-pinned-tab.svg`） | ⚠ 上游资产，待替换 |
| 托盘图标 | `public/img/icons/menu-{dark,light}@88.png` | ⚠ 上游资产，待替换 |
| 上游 logo 与 README 截图 | `images/` | ✅ 已排除，未纳入本仓库 |
| 登录页 / Last.fm 回调页 logo | `public/img/logos/aki-music.svg` | ✅ 已替换为自有占位字标 |
| Linux 标题栏标记 | `public/img/logos/aki-mark-white.svg` | ✅ 已替换为自有占位标记 |
| 第三方图标（网易云 / Last.fm / nyancat） | `public/img/logos/{netease-music,lastfm,nyancat*}.*` | 属各自权利人，仅用于指向对应服务，保留 |

**替换方式**：`npm run electron:buildicon` 可由单张 1024×1024 源图生成 `build/icons/` 全套。
建议在 M5「品牌全套」一次性完成，并同步替换 `public/img/icons/` 下的 PWA 与托盘图标。

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

---

## 4. 待办（阻塞对外发布）

| # | 事项 | 位置 | 里程碑 |
|---|---|---|---|
| 1 | 替换全部上游图标资产（见第 2 节） | `build/icons/`、`public/img/icons/` | M5 |
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
