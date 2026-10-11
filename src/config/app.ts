// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 产品标识与对外链接的单一来源。
 *
 * 产品名、仓库地址只在这里定义一次，避免散落到各处后改不干净。
 * 主进程与渲染进程都需要引用，因此不依赖任何浏览器/Node 专有 API。
 *
 * 本文件是项目里第一个 TypeScript 源码文件，用于验证 TS 链路（M1a）。
 */

/** 产品展示名。用于窗口标题、托盘、媒体身份、菜单等所有用户可见处。 */
export const PRODUCT_NAME: string = 'Aki Music';

/**
 * 对外仓库地址。
 *
 * 留空时，相关 UI 入口（导航栏 GitHub 按钮、帮助菜单项）自动隐藏，
 * 避免指向错误或不存在的地址。
 *
 * TODO(M5 发布前): 填入实际仓库地址，例如 'https://github.com/<owner>/aki-music'。
 */
export const REPO_URL: string = '';

/** 发布页地址；REPO_URL 为空时同样为空。 */
export const RELEASES_URL: string = REPO_URL ? `${REPO_URL}/releases` : '';

/**
 * Discord Rich Presence 的应用 ID。
 *
 * 上游使用的是 YesPlayMusic 自己的 Discord 应用，沿用会让本项目的用户
 * 在 Discord 上显示为另一个产品，因此留空停用整条链路。
 *
 * TODO(M5 发布前): 在 Discord Developer Portal 注册 Aki Music 应用后填入。
 */
export const DISCORD_APP_ID: string = '';
