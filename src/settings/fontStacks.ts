// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 folia-major（AGPL-3.0，https://github.com/chthollyphile/folia-major）
//   src/utils/fontStacks.ts
// Modified for Aki Music on 2026-10-11:
//   1. 只保留歌词页需要的能力（栈定义 / 归一化 / 引用转义 / 自定义字体插到栈首）
//   2. 预设增加「跟随应用」（保持 Barlow 现状），系统字体栈按平台回落顺序整理
//   3. 去掉 tema/fontWeight 相关部分（本项目字号走现有的设置项）
//
// 歌词页的字体选择模型：
//   preset = 'app'  → 只用应用自带字体（Barlow），与改造前的观感完全一致
//   preset = 'sans' | 'serif' | 'mono' → folia 的系统字体栈（黑体 / 宋体 / 等宽）
//   preset = 'custom' + family → 任意本机字体或上传的字体，插到应用字体栈最前面

export type LyricsFontPreset = 'app' | 'sans' | 'serif' | 'mono' | 'custom';

/** 应用自带字体（global.scss 里注册的 Barlow） */
const APP_FONT_FAMILY = 'Barlow';

/**
 * 系统字体栈。顺序即回落顺序：先装的字体先命中，最后一定要给一个通用族。
 * 与 folia 的差异：去掉它自带的「獅尾四季春加糖SC」等本项目未打包的字体，
 * 避免装不上时用户以为设置没生效。
 */
export const BUILTIN_FONT_STACKS: Record<'sans' | 'serif' | 'mono', string> = {
  sans: '"Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  serif:
    '"Iowan Old Style", "Noto Serif CJK SC", "Noto Serif JP", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", "Georgia", serif',
  mono: '"IBM Plex Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "SFMono-Regular", Consolas, "MS Gothic", monospace',
};

/** 预设 → 各语言的展示名（真正的文案在 locale 里，这里只做兜底） */
export const FONT_PRESET_FALLBACK_LABELS: Record<LyricsFontPreset, string> = {
  app: '跟随应用',
  sans: '黑体',
  serif: '宋体',
  mono: '等宽',
  custom: '自定义',
};

const CSS_GENERIC_FONT_FAMILIES = new Set([
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

const normalizeFontFamilyName = (fontFamily: string): string =>
  fontFamily
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();

/** 按 CSS 规则转义字体名（含空格/引号的名字必须加引号） */
const formatFontFamily = (fontFamily: string): string | null => {
  const normalized = normalizeFontFamilyName(fontFamily);
  if (!normalized) return null;

  return CSS_GENERIC_FONT_FAMILIES.has(normalized.toLowerCase())
    ? normalized
    : `"${normalized.replace(/["\\]/g, '\\$&')}"`;
};

/** 归一化字体栈：去空、去重（大小写不敏感）、保序 */
export const normalizeFontFamilyStack = (
  fontFamilies: Array<string | null | undefined> | null | undefined
): string[] => {
  const seen = new Set<string>();
  const stack: string[] = [];

  fontFamilies?.forEach(fontFamily => {
    const normalized = normalizeFontFamilyName(fontFamily ?? '');
    if (!normalized) return;

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    stack.push(normalized);
  });

  return stack;
};

/** 把归一化后的字体栈拼成可直接写进 CSS 的 font-family 值 */
export const buildFontFamilyCss = (
  fontFamilies: Array<string | null | undefined>
): string =>
  normalizeFontFamilyStack(fontFamilies)
    .map(formatFontFamily)
    .filter(Boolean)
    .join(', ');

/**
 * 字体设置。**字段名必须与 store 的 settings 一致** —— 调用方直接把
 * `store.state.settings` 传进来即可，不要再包一层 `{preset, family}`：
 * 曾经因为包了这一层，所有预设都静默回落成了默认字体。
 */
export interface LyricsFontSetting {
  lyricsFontPreset?: LyricsFontPreset | string | null;
  /** preset = 'custom' 时使用的字体名（本机字体或上传字体的家族名） */
  lyricsFontFamily?: string | null;
}

/**
 * 设置 → CSS font-family。这是歌词页/桌面歌词/远程窗口共用的**唯一**解析入口。
 *
 * - 'app'：只有 Barlow（与改造前一致；CJK 交给浏览器默认，即系统中文界面字体）
 * - 'sans' / 'serif' / 'mono'：系统字体栈
 * - 'custom'：自定义字体在前，后面接 Barlow 与 sans-serif，保证缺字时仍有回落
 * - 未知/空值：按 'app' 处理
 */
export const resolveLyricsFontFamily = (
  setting: LyricsFontSetting | null | undefined
): string => {
  const preset = (setting?.lyricsFontPreset ?? 'app') as LyricsFontPreset;

  if (preset === 'custom') {
    const family = normalizeFontFamilyName(setting?.lyricsFontFamily ?? '');
    if (family) {
      return buildFontFamilyCss([
        family,
        APP_FONT_FAMILY,
        ...BUILTIN_FONT_STACKS.sans.split(','),
      ]);
    }
    // 自定义字体还没选好 → 先按应用字体显示，不要留空
    return APP_FONT_FAMILY;
  }

  if (preset === 'sans' || preset === 'serif' || preset === 'mono') {
    return BUILTIN_FONT_STACKS[preset];
  }

  return APP_FONT_FAMILY;
};

/** 当前选择的人类可读标签（设置页显示用） */
export const describeLyricsFont = (
  setting: LyricsFontSetting | null | undefined
): string => {
  const preset = (setting?.lyricsFontPreset ?? 'app') as LyricsFontPreset;
  if (preset === 'custom') {
    const family = normalizeFontFamilyName(setting?.lyricsFontFamily ?? '');
    return family || FONT_PRESET_FALLBACK_LABELS.custom;
  }
  return FONT_PRESET_FALLBACK_LABELS[preset] ?? FONT_PRESET_FALLBACK_LABELS.app;
};
