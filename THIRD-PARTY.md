# THIRD-PARTY — 依赖与许可证清单

> **状态：骨架，尚未完整核验。** 依赖清单随 M1a 的构建链升级已更新；
> 逐项许可证核验仍待完成（见第 3 节流程）。
> 上游署名与 AGPL 合规记录见 [NOTICE.md](./NOTICE.md)。

---

## 1. 已核验的许可证（通过读取本地 `LICENSE` 文件）

| 项目 | 与本项目的关系 | 许可证 | 核验依据 |
|---|---|---|---|
| YesPlayMusic | 基线源码 | MIT | 上游仓库 `LICENSE`（全文见 NOTICE §1.1） |
| folia-major | 计划移植（M2/M3），**尚未引入** | AGPL-3.0 | 上游仓库 `LICENSE` |
| api-enhanced | 计划依赖（M1b），**尚未引入** | MIT | 上游仓库 `LICENSE` |
| YesPlayMusic-listen-together-support | 计划移植（M4），**尚未引入** | MIT | 上游仓库 `LICENSE` |
| amll-ttml-db | 运行时数据源（官方 API） | CC0 1.0（社区创作部分） | 上游仓库 `LICENSE` |

---

## 2. 直接依赖（M1a 后的清单）

以下依赖来自 `package.json`。**它们的许可证此处刻意留空**，原因：仅凭记忆判断许可证
存在出错风险，而许可证判断错误本身就是合规缺陷，因此宁可不填，也不预填可能错误的信息。

### 运行时依赖（`dependencies`）

```
@neteaseapireborn/api 4.29.7   # 内嵌 API；精确锁定，M1b 将替换为 api-enhanced
@unblockneteasemusic/rust-napi # 原生模块（音源解锁）
axios            change-case      cli-color         color
crypto-js        dayjs            dbus-next         dexie
electron-devtools-installer        electron-store    electron-updater
express          express-fileupload                 express-http-proxy
howler           js-cookie        jsbi              lodash
md5              mpris-service    node-vibrant      nprogress
pac-proxy-agent  plyr             qrcode            tunnel
vscode-codicons  vue              vue-clipboard2    vue-i18n
vue-router       vue-slider-component               vuex
x11
```

### 开发依赖（`devDependencies`）

```
@types/node  @vitejs/plugin-vue2  babel-eslint  electron  electron-builder
esbuild  eslint  eslint-config-prettier  eslint-plugin-prettier
eslint-plugin-vue  husky  png-to-ico  png2icons  prettier  sass  sharp
typescript  vite  vite-plugin-pwa
```

> `electron` 与 `electron-builder` 是**构建工具**，必须在 devDependencies
> ——electron-builder 26 会校验并拒绝打包否则（上游把它们放在 dependencies 里）。
>
> `sharp` 用于生成应用图标（`scripts/generate-icons.mjs`），其平台二进制来自
> `optionalDependencies`（`@img/sharp-*`），会随安装一并进入 —— 许可证核验时
> 需连同这些可选依赖一起看。

### M1a 的依赖变更（核验时注意这些是新引入的）

- **新增且需核验**：`vite`、`@vitejs/plugin-vue2`、`vite-plugin-pwa`、`typescript`、`dbus-next`
  （`sass` 为升级）；**应用图标补充**：`sharp`、`png-to-ico`、`png2icons`
- **移除**：`@vue/cli-*`、`vue-cli-plugin-electron-builder`、`vue-template-compiler`、`core-js`、
  `esbuild-loader`、`svg-sprite-loader`、`register-service-worker`、`vue-gtag`、
  `discord-rich-presence`（供应链原因，见 NOTICE）、
  `electron-icon-builder`（连带 sharp 0.29 / phantomjs-prebuilt / icon-gen 一并离开依赖树）
- **改为精确锁定**：`@neteaseapireborn/api` → `4.29.7`

### M1b 的依赖变更

- **升级**：`electron` 13 → 43.7.9、`electron-builder` 23 → 26、`electron-updater` 5 → 6、
  `electron-devtools-installer` 3 → 4（均需重新核验其传递依赖树）
- **移除**：`electron-context-menu`、`electron-debug`、`electron-log`、`electron-is-dev`、
  `extract-zip`、`music-metadata` —— 六者在 `src/` 中**从未被使用**，属上游遗留

### 待办（核验流程）

1. 运行许可证扫描，例如：

   ```bash
   pnpm licenses list --long        # 或 npx license-checker --summary
   ```

2. **逐项确认与 AGPL-3.0 的兼容性**。判定口径：
   - ✅ 兼容：MIT / BSD-2 / BSD-3 / Apache-2.0 / ISC / CC0 / Unlicense / 0BSD 等宽松许可
   - ⚠ 需审查：CC-BY 系列（要求署名）、MPL-2.0（文件级 copyleft）、EPL
   - ❌ 不兼容：GPL-2.0-only / 专有许可 / **许可证字段缺失**（默认保留全部权利）
3. 对不兼容项：替换为等价依赖，或移除该功能
4. 将结果、扫描命令与执行日期补入本文件，替换第 2 节的说明
5. 注意**打包进前端产物的依赖同样受约束**（图标字体、UI 库、可视化库等）
6. 在 CI 中加入许可证检查，避免新依赖未经核验就合入

### 已知需重点确认的项

| 依赖 | 关注点 |
|---|---|
| `@neteaseapireborn/api` | 需确认其许可证；M1b 将被 `api-enhanced`（MIT）替换 |
| `@unblockneteasemusic/rust-napi` | 原生二进制，需确认随附许可证与其再分发条款 |
| `vscode-codicons` | 图标字体类资源常采用 **CC-BY-4.0**（要求署名），需确认并登记署名 |
| `plyr` | 安装时被标记为 deprecated（仅安全更新），需确认许可证与后续替代方案 |
| `node-vibrant` | 使用的是 `3.2.1-alpha.1`（alpha 版本），需确认 |
| `x11` / `mpris-service` / `dbus-next` | 平台特定系统集成依赖，需确认 |
| `electron` / `electron-builder` 及其子依赖 | 大量传递依赖，需整链核验 |
| `electron-builder` 的打包组件 | `electron-winstaller`（Squirrel.Windows）与 `app-builder-bin` 等仅在打包时使用，需确认 |

---

## 3. 兼容性总原则

本项目以 **AGPL-3.0-or-later** 发布，因此：

1. **所有随产物分发的代码**（前端打包产物 + Electron 主进程 + 原生模块）都必须与 AGPL-3.0 兼容；
2. **服务端部署**同样触发 AGPL 第 13 条（网络交互）的源码提供义务——若本项目提供 Web 版，
   必须在界面上提供源码获取入口；
3. 引入新依赖时，先确认许可证再合并，不要事后补。
