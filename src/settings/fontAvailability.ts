// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 folia-major（AGPL-3.0，https://github.com/chthollyphile/folia-major）
//   src/utils/fontAvailability.ts
// Modified for Aki Music on 2026-10-11: 原样移植（只调整注释），逻辑未改。
//
// 判断某个字体族在本机是否真的能渲染 —— 不申请权限、不弹窗，用画布测量代替。
//
// 为什么不用 queryLocalFonts 判断：那是 Chromium 专有的 Local Font Access API，
// 需要用户授权，而字体选择列表里"哪些字体本机装了"只是展示信息，不值得为此弹权限框。
// 测量法：先用通用族渲染探针文本量一次宽度，再把候选字体插到通用族前面量一次；
// 宽度不同说明候选字体参与了渲染（即本机存在）。

// 混排宽窄拉丁与中文，字体替换后宽度差异会明显暴露出来。
const PROBE_TEXT = 'mmmmmmmmmmlliWWWWWWWWWW永和九年';

// 三个通用族都比一遍：一个字体恰好与某个通用族度量一致的几率很低，
// 只要有一个不同就认为存在，避免假阴性。
const SENTINELS = ['monospace', 'serif', 'sans-serif'];

const CSS_GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

const quote = (family: string) => `"${family.replace(/["\\]/g, '\\$&')}"`;

/**
 * 字体族在本机是否可用。
 * 无法测量的环境（没有 DOM / 没有 2d context）一律返回 true ——
 * 这个函数是用来给"可能回落"的字体做提示的，提示错了比不提示更糟。
 */
export function isFontFamilyAvailable(family: string): boolean {
  const name = family
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
  if (!name) return false;
  // 通用族一定解析得到东西
  if (CSS_GENERIC_FAMILIES.has(name.toLowerCase())) return true;
  if (typeof document === 'undefined') return true;

  const context = document.createElement('canvas').getContext('2d');
  if (!context) return true;

  return SENTINELS.some(sentinel => {
    context.font = `72px ${sentinel}`;
    const baseline = context.measureText(PROBE_TEXT).width;
    context.font = `72px ${quote(name)}, ${sentinel}`;
    return context.measureText(PROBE_TEXT).width !== baseline;
  });
}

/** 可用性缓存：批量渲染字体列表时逐个测量开销不小，按字体名缓存结果 */
const availabilityCache = new Map<string, boolean>();

export function isFontFamilyAvailableCached(family: string): boolean {
  const key = family.trim().toLowerCase();
  if (!key) return false;
  const cached = availabilityCache.get(key);
  if (cached !== undefined) return cached;

  const available = isFontFamilyAvailable(family);
  availabilityCache.set(key, available);
  return available;
}
