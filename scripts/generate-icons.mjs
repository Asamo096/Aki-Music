// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 从母图生成桌面应用图标。
 *
 * 用法：pnpm icons
 *
 * 母图：build/icon.png（方形、角部透明的 PNG，建议 ≥1024×1024）
 * 产物：build/icons/
 *   - 16x16.png … 1024x1024.png   各尺寸 PNG（Linux 图标集 / 通用回退）
 *   - icon.ico                    多尺寸 Windows 图标
 *   - icon.icns                   macOS 图标
 *
 * 取代上游的 electron-icon-builder：后者依赖 sharp 0.29 与 phantomjs-prebuilt，
 * 在 Node 24 下装不上（其安装脚本也被 pnpm 的供应链护栏拦截），且它会给
 * build/ 目录留下一堆额外产物。本脚本只生成真正需要的文件。
 *
 * 注意：仅用于**应用图标**。托盘图标（public/img/icons/menu-*.png）与
 * favicon / PWA 图标（public/img/icons/*）是独立资产，不在此脚本范围内。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import png2icons from 'png2icons';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const masterPath = path.join(root, 'build', 'icon.png');
const outDir = path.join(root, 'build', 'icons');

/** 生成的 PNG 尺寸 */
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** icon.ico 内包含的尺寸（Windows 多尺寸图标） */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(masterPath)) {
    throw new Error(`找不到母图：${masterPath}`);
  }

  const master = sharp(masterPath);
  const meta = await master.metadata();
  if (meta.width !== meta.height) {
    throw new Error(
      `母图必须是正方形，当前为 ${meta.width}×${meta.height}`
    );
  }
  if (meta.width < 512) {
    console.warn(
      `⚠ 母图仅 ${meta.width}×${meta.height}，建议至少 512×512（1024 以上更好）`
    );
  }

  fs.mkdirSync(outDir, { recursive: true });

  // 1. 各尺寸 PNG
  for (const size of SIZES) {
    const file = path.join(outDir, `${size}x${size}.png`);
    await sharp(masterPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(file);
  }

  // 2. Windows .ico（由上述 PNG 组成多尺寸图标）
  const icoBuffers = await Promise.all(
    ICO_SIZES.map(size =>
      fs.promises.readFile(path.join(outDir, `${size}x${size}.png`))
    )
  );
  const ico = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  // 3. macOS .icns
  // png2icons 需要一张足够大的源图，自行生成内部各尺寸
  const source = await fs.promises.readFile(path.join(outDir, '1024x1024.png'));
  const icns = png2icons.createICNS(source, png2icons.BILINEAR, 0);
  if (!icns) throw new Error('生成 .icns 失败（png2icons 返回空）');
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icns);

  // 4. 汇总
  console.log(
    `母图 ${meta.width}×${meta.height} → build/icons/`
  );
  for (const size of SIZES) {
    const f = path.join(outDir, `${size}x${size}.png`);
    console.log(
      `  ${String(size).padStart(4)}×${String(size).padEnd(4)} ${(
        fs.statSync(f).size / 1024
      ).toFixed(1)} KB`
    );
  }
  console.log(`   icon.ico       ${(ico.length / 1024).toFixed(1)} KB`);
  console.log(`   icon.icns      ${(icns.length / 1024).toFixed(1)} KB`);
}

await main();
