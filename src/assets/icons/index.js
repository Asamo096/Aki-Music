// SPDX-License-Identifier: AGPL-3.0-or-later
import Vue from 'vue';
import SvgIcon from '@/components/SvgIcon';

Vue.component('SvgIcon', SvgIcon);

/**
 * SVG 图标注册。
 *
 * 上游用 webpack 的 svg-sprite-loader 把 src/assets/icons/*.svg 编成一张 sprite，
 * 再由 <SvgIcon icon-class="play"> 通过 #icon-play 引用。Vite 没有等价的 loader，
 * 这里用 import.meta.glob 在运行时做同样的事：把每个 SVG 转成 <symbol> 拼成
 * 一张 sprite 注入 DOM。SvgIcon.vue 因此无需改动。
 */
const modules = import.meta.glob('./*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const DEFAULT_VIEW_BOX = '0 0 1024 1024';

/**
 * 把一份 SVG 原文转成 <symbol>。
 *
 * @param {string} name 图标名（文件名去扩展名）
 * @param {string} raw SVG 原文
 * @returns {string}
 */
function toSymbol(name, raw) {
  const viewBox = raw.match(/viewBox="([^"]+)"/)?.[1] ?? DEFAULT_VIEW_BOX;
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '');
  return `<symbol id="icon-${name}" viewBox="${viewBox}">${inner}</symbol>`;
}

const symbols = Object.entries(modules)
  .map(([filePath, raw]) => {
    const name = filePath.replace(/^\.\//, '').replace(/\.svg$/, '');
    return toSymbol(name, /** @type {string} */ (raw));
  })
  .join('');

const sprite = document.createElement('div');
sprite.setAttribute('aria-hidden', 'true');
sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
sprite.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
document.body.insertBefore(sprite, document.body.firstChild);
