// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 歌词背景风格注册表（M2-C）。
 *
 * 四种是 YesPlayMusic 原有的（必须保留），第五种是本次新增的多色动态模糊背景。
 * 注册表把「值、展示名、成本、是否深色主题」集中在一处，设置页与歌词页的开关
 * 都从这里取，避免两处各写一份 switch。
 *
 * 关于"设置迁移"：`settings.lyricsBackground` 的取值域从
 * `boolean | 'blur' | 'dynamic'` 扩展为加上 `'fluid'`，
 * **旧值语义完全不变**，因此不需要任何数据迁移代码（改前是布尔值或字符串的用户，
 * 升级后行为与之前逐字节一致）。
 */
export type LyricBackgroundStyle =
  | true // 取色渐变（原有）
  | 'blur' // 模糊封面（原有）
  | 'dynamic' // 动态模糊封面（原有）
  | 'fluid' // 多色动态模糊背景（新增）
  | false; // 关闭

export interface LyricBackgroundStyleMeta {
  value: LyricBackgroundStyle;
  /** i18n 键后缀（settings.lyricsBackground.*） */
  labelKey: string;
  /** 渲染成本的粗略标注，给用户做取舍用 */
  cost: 'low' | 'medium' | 'high';
  /** 是否强制深色主题（背景本身很暗，浅色文字才读得清） */
  darkTheme: boolean;
  /** 是否为本次新增 */
  isNew?: boolean;
}

export const LYRIC_BACKGROUND_STYLES: LyricBackgroundStyleMeta[] = [
  { value: true, labelKey: 'on', cost: 'low', darkTheme: true },
  { value: 'blur', labelKey: 'blur', cost: 'low', darkTheme: false },
  { value: 'dynamic', labelKey: 'dynamic', cost: 'medium', darkTheme: false },
  {
    value: 'fluid',
    labelKey: 'fluid',
    cost: 'high',
    darkTheme: true,
    isNew: true,
  },
  { value: false, labelKey: 'off', cost: 'low', darkTheme: false },
];

const VALID_VALUES: LyricBackgroundStyle[] = LYRIC_BACKGROUND_STYLES.map(
  style => style.value
);

/** 归一化：任何历史值/脏值都映射回合法值（未知值按原有默认 true 处理） */
export const normalizeLyricBackgroundStyle = (
  value: unknown
): LyricBackgroundStyle =>
  VALID_VALUES.includes(value as LyricBackgroundStyle)
    ? (value as LyricBackgroundStyle)
    : true;

export const getLyricBackgroundMeta = (
  value: unknown
): LyricBackgroundStyleMeta =>
  LYRIC_BACKGROUND_STYLES.find(
    style => style.value === normalizeLyricBackgroundStyle(value)
  ) ?? LYRIC_BACKGROUND_STYLES[0];

/** 该风格是否用深色主题 */
export const isDarkBackgroundStyle = (value: unknown): boolean =>
  getLyricBackgroundMeta(value).darkTheme;
