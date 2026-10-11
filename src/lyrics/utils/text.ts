// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 歌词文本推导 —— 引擎、歌词页、桌面歌词、远程控制窗口共用。
 * 原文统一按 words 拼接推导，避免各处重复实现。
 */
import type { LyricLine } from '../types';

/** 行的原文（按词拼接，含词间空格——空格本身就在词里） */
export const getLineText = (line: Pick<LyricLine, 'words'>): string =>
  line.words.map(w => w.text).join('');

/** 行的次要文本：翻译或音译，取不到返回空串 */
export const getLineSecondaryText = (
  line: Pick<LyricLine, 'translation' | 'roman'>,
  kind: 'translation' | 'romaPronunciation'
): string => (kind === 'translation' ? line.translation : line.roman) ?? '';
