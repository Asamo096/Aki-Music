// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * node-vibrant 的 worker 构建没有类型声明（npm 上是 3.2.1-alpha 版本）。
 * 项目里 JS 侧一直在用 `vibrant.worker.min.js` 这个入口（避免打包 worker chunk），
 * 这里只手写我们在用到的部分，不假装完整。
 */
declare module 'node-vibrant/dist/vibrant.worker.min.js' {
  export interface VibrantSwatch {
    hex: string;
    rgb: [number, number, number];
    population: number;
  }

  export interface VibrantPalette {
    Vibrant?: VibrantSwatch;
    LightVibrant?: VibrantSwatch;
    DarkVibrant?: VibrantSwatch;
    Muted?: VibrantSwatch;
    LightMuted?: VibrantSwatch;
    DarkMuted?: VibrantSwatch;
    [key: string]: VibrantSwatch | undefined;
  }

  export interface VibrantOptions {
    colorCount?: number;
    quality?: number;
  }

  export interface VibrantInstance {
    getPalette(): Promise<VibrantPalette>;
  }

  export function from(src: string, options?: VibrantOptions): VibrantInstance;
}
