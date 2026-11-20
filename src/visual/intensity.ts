// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 音频能量 → 0..1 的视觉强度（纯函数，供背景/歌词/脉冲层共用）。
 *
 * 直接用 power/255 会太小（真实音乐多数时候只有 20–80/255），
 * 这里用 140 作为“强节拍”参考值做归一化，再乘用户强度；
 * 视觉上才看得出鼓点，同时保留上限避免过曝。
 */

/** 视为“满强度”的能量参考值（0..255 量纲） */
export const AUDIO_POWER_GAIN = 140;

export interface AudioLevelSettings {
  enabled?: boolean;
  intensity?: number;
  reduceMotion?: boolean;
}

export const resolveAudioLevel = (
  power: number,
  settings: AudioLevelSettings = {}
): number => {
  if (settings.enabled === false || settings.reduceMotion) return 0;
  const intensity =
    Number.isFinite(settings.intensity) && settings.intensity !== undefined
      ? Number(settings.intensity)
      : 0.6;
  if (intensity <= 0 || !Number.isFinite(power) || power <= 0) return 0;
  const normalized = Math.min(1, power / AUDIO_POWER_GAIN);
  return Math.min(1, normalized * intensity);
};
