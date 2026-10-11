// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 歌词引擎的数据契约。
 *
 * 这是整个歌词系统的**唯一数据形状**：所有格式适配器都归一到它，
 * 渲染层与可视化层只依赖它。因此本文件（以及 src/lyrics 下的所有文件）
 * **不得引入 Vue / DOM 依赖**，以便独立测试与复用。
 *
 * 时间单位统一为**秒**（与项目既有约定一致：`utils/lyrics.js` 与播放器都用秒）。
 * 注意上游解析器（AMLL TTML、网易 yrc）给的是毫秒，适配器负责换算。
 */
import type { LineRenderHints } from './timing/renderHints';

/** 一个词/音节的时间区间 */
export interface LyricWord {
  text: string;
  /** 起始时间（秒） */
  startTime: number;
  /** 结束时间（秒） */
  endTime: number;
}

/** 一行歌词 */
export interface LyricLine {
  /**
   * 词序列。
   * - 逐字歌词：按词/音节切分
   * - 行级歌词：单元素，即整行作为一个"词"（渲染层据此退化为按行高亮）
   */
  words: LyricWord[];
  /** 行起始（秒） */
  startTime: number;
  /** 行结束（秒） */
  endTime: number;
  /** 翻译（行级文本） */
  translation?: string;
  /** 罗马音 / 音译 */
  roman?: string;
  /** 是否为背景人声行 */
  background?: boolean;
  /** 是否为对唱行（AMLL 标注，渲染层可据此右对齐） */
  duet?: boolean;
  /**
   * 渲染提示（由 timing/renderHints 计算）。纯派生数据，算一次即可复用，
   * 因此挂在行上做缓存 —— 见 annotateLyricLines / ensureLyricDataRenderHints。
   */
  renderHints?: LineRenderHints;
}

/** 歌词格式 */
export type LyricFormat = 'ttml' | 'yrc' | 'lrc';

/** 数据来源标识（用于界面展示与问题定位） */
export type LyricSourceId =
  | 'amll' //                          AMLL TTML DB（人工校对，含翻译/罗马音/背景人声）
  | 'netease-yrc' //                  网易云逐字歌词
  | 'netease-lrc'; //                 网易云行级歌词（含翻译/罗马音）

/** 解析结果 */
export interface LyricData {
  lines: LyricLine[];
  format: LyricFormat;
  source: LyricSourceId;
  /**
   * 是否含逐字时间。
   * false 表示只有行级时间（渲染层应按行高亮，而不是假装逐字）。
   */
  hasWordTiming: boolean;
  /**
   * 署名信息（目前只有 AMLL 提供：社区校对者的 GitHub 用户名）。
   * 界面用它致谢，见 AMLL 的收录规则。
   */
  attribution?: string;
}

/** 数据源声明的"质量档位"，用于 UI 提示与预期管理 */
export const SOURCE_LABELS: Record<LyricSourceId, string> = {
  amll: 'AMLL 校对',
  'netease-yrc': '网易云逐字',
  'netease-lrc': '普通歌词',
};
