// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 「歌曲无法播放时怎么办」的策略常量。
 *
 * 独立成模块是为了让 player.js 与 listenTogether.js 都能引用，
 * 同时避免两者之间形成循环依赖。
 */
export const UNPLAYABLE_CONDITION = {
  /** 跳到下一首（默认） */
  PLAY_NEXT_TRACK: 'playNextTrack',
  /** 跳到上一首 */
  PLAY_PREV_TRACK: 'playPrevTrack',
  /** 停在原地（一起听跟随用：房间指定的歌放不了时不要自动跳走，否则会偏离房间） */
  STOP: 'stop',
};
