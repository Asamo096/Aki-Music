# THIRD-PARTY — 依赖与许可证清单

> **状态：M0 骨架，尚未完整核验。** 完整清单需在 M1 安装依赖后生成并逐项确认。
> 上游署名与 AGPL 合规记录见 [NOTICE.md](./NOTICE.md)。

---

## 1. 已核验的许可证（通过读取本地 `LICENSE` 文件）

| 项目 | 与本项目的关系 | 许可证 | 核验依据 |
|---|---|---|---|
| YesPlayMusic | 基线源码 | MIT | 上游仓库 `LICENSE`（全文见 NOTICE §1.1） |
| folia-major | 计划移植（M2/M3），**尚未引入** | AGPL-3.0 | 上游仓库 `LICENSE` |
| api-enhanced | 计划依赖（M1），**尚未引入** | MIT | 上游仓库 `LICENSE` |
| YesPlayMusic-listen-together-support | 计划移植（M4），**尚未引入** | MIT | 上游仓库 `LICENSE` |
| amll-ttml-db | 运行时数据源（官方 API） | CC0 1.0（社区创作部分） | 上游仓库 `LICENSE` |

---

## 2. 直接依赖 —— **尚未核验**

以下依赖来自 `package.json`。**它们的许可证此处刻意留空**，原因：

本仓库尚未安装 `node_modules`，无法读取各依赖包自带的 `LICENSE` 文件。
仅凭记忆填写许可证存在出错风险，而许可证判断错误本身就是合规缺陷，
因此宁可不填，也不预填可能错误的信息。

### 运行时依赖（`dependencies`）

```
@neteaseapireborn/api          # ⚠ M1 将替换为 api-enhanced
@unblockneteasemusic/rust-napi # 原生模块（音源解锁）
axios               change-case       cli-color          color
core-js             crypto-js         dayjs              dexie
discord-rich-presence                 electron           electron-builder
electron-context-menu                 electron-debug     electron-devtools-installer
electron-icon-builder                 electron-is-dev    electron-log
electron-store      electron-updater  esbuild            esbuild-loader
express             express-fileupload                   express-http-proxy
extract-zip         howler            js-cookie          jsbi
lodash              md5               mpris-service      music-metadata
node-vibrant        nprogress         pac-proxy-agent    plyr
qrcode              register-service-worker               svg-sprite-loader
tunnel              vscode-codicons   vue                vue-clipboard2
vue-i18n            vue-router        vue-slider-component                  vuex
x11
```

### 开发依赖（`devDependencies`）

```
@types/node  @vue/cli-*  babel-eslint  eslint  eslint-config-prettier
eslint-plugin-prettier  eslint-plugin-vue  husky  prettier  sass
sass-loader  vue-cli-plugin-electron-builder  vue-template-compiler
```

### M1 待办（核验流程）

1. 安装依赖后运行许可证扫描，例如：

   ```bash
   pnpm licenses list --long        # 或 npx license-checker --summary
   ```

2. **逐项确认与 AGPL-3.0 的兼容性**。判定口径：
   - ✅ 兼容：MIT / BSD-2 / BSD-3 / Apache-2.0 / ISC / CC0 / Unlicense / 0BSD 等宽松许可
   - ⚠ 需审查：CC-BY 系列（要求署名）、MPL-2.0（文件级 copyleft）、EPL
   - ❌ 不兼容：GPL-2.0-only / 专有许可 / **许可证字段缺失**（默认保留全部权利）
3. 对不兼容项：替换为等价依赖，或移除该功能
4. 将结果、扫描命令与执行日期补入本文件，替换第 2 节的占位说明
5. 注意**打包进前端产物的依赖同样受约束**（图标字体、UI 库、可视化库等）

### 已知需重点确认的项

| 依赖 | 关注点 |
|---|---|
| `@neteaseapireborn/api` | 需确认其许可证；M1 将被 `api-enhanced`（MIT）替换 |
| `@unblockneteasemusic/rust-napi` | 原生二进制，需确认随附许可证与其再分发条款 |
| `vscode-codicons` | 图标字体类资源常采用 **CC-BY-4.0**（要求署名），需确认并登记署名 |
| `plyr` | 需确认（历史版本许可证曾变动） |
| `node-vibrant` | 使用的是 `3.2.1-alpha.1`（alpha 版本），需确认 |
| `x11` / `mpris-service` | 平台特定原生/系统集成依赖，需确认 |

---

## 3. 兼容性总原则

本项目以 **AGPL-3.0-or-later** 发布，因此：

1. **所有随产物分发的代码**（前端打包产物 + Electron 主进程 + 原生模块）都必须与 AGPL-3.0 兼容；
2. **服务端部署**同样触发 AGPL 第 13 条（网络交互）的源码提供义务——若本项目提供 Web 版，
   必须在界面上提供源码获取入口；
3. 引入新依赖时，先确认许可证再合并，不要事后补；CI 中应加入许可证检查（M1 起）。
