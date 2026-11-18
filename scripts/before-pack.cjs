// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * electron-builder beforePack 钩子：把 koffi 的平台原生包暂存到 build/native/koffi。
 *
 * 为什么需要这一步：
 *   koffi 3.x 把原生二进制放在独立平台包 `@koromix/koffi-<platform>-<arch>` 里，
 *   并且是 koffi 的 optionalDependencies。在 pnpm 的严格依赖布局下，这个包在虚拟目录
 *   （node_modules/.pnpm/...）里，electron-builder 不会自动带进产物；而 extraResources
 *   的 `from` 不支持 glob，没法直接指过去。
 *
 * 做法：在打包前按当前平台把该包**拷贝**到固定路径 build/native/koffi，
 * 由 electron-builder.yml 的 extraResources 拷到 resources/koffi。
 * koffi 的加载器会探测 `resourcesPath/koffi/<triplet>/koffi.node`（见 koffi/src/init.js），
 * 而平台包内部的目录名恰好就是 <platform>_<arch>（如 win32_x64），所以整包拷贝即可。
 *
 * 找不到时只警告不中断：非 Windows 平台本来就不需要它（桌面歌词仅 Windows）。
 */
const fs = require('node:fs');
const path = require('node:path');

const log = message => console.log(`[before-pack] ${message}`);

/** 递归拷贝（去掉符号链接，避免把 pnpm store 的链接结构带进产物） */
const copyDir = (source, target) => {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) {
      const real = fs.realpathSync(from);
      if (fs.statSync(real).isDirectory()) copyDir(real, to);
      else fs.copyFileSync(real, to);
    } else if (stat.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
};

exports.default = async function beforePack() {
  const platformPackage = `@koromix/koffi-${process.platform}-${process.arch}`;
  const stagedDir = path.join(__dirname, '..', 'build', 'native', 'koffi');

  try {
    const koffiEntry = require.resolve('koffi');
    // koffi 的入口在 <store>/node_modules/koffi/，同级的 @koromix 就是平台包
    const sourceDir = path.resolve(path.dirname(koffiEntry), '..', platformPackage);
    if (!fs.existsSync(sourceDir)) {
      log(`未找到 ${platformPackage}（sourceDir=${sourceDir}）；桌面歌词在该平台不可用`);
      return;
    }
    fs.rmSync(stagedDir, { recursive: true, force: true });
    copyDir(sourceDir, stagedDir);
    log(`已暂存 ${platformPackage} → build/native/koffi`);
  } catch (error) {
    log(`暂存 koffi 原生包失败：${error?.message || error}`);
  }
};
