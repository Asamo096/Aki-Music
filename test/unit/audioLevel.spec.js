import { describe, expect, it } from 'vitest';
import {
  resolveAudioLevel,
  AUDIO_POWER_GAIN,
} from '../../src/visual/intensity';

describe('resolveAudioLevel', () => {
  it('按 140 参考值归一化并乘强度', () => {
    expect(resolveAudioLevel(0, { intensity: 0.6 })).toBe(0);
    expect(resolveAudioLevel(70, { intensity: 0.6 })).toBeCloseTo(0.3, 5);
    expect(resolveAudioLevel(AUDIO_POWER_GAIN, { intensity: 0.6 })).toBeCloseTo(
      0.6,
      5
    );
  });

  it('超过参考值夹在强度上限', () => {
    expect(resolveAudioLevel(255, { intensity: 0.6 })).toBeCloseTo(0.6, 5);
    expect(resolveAudioLevel(255, { intensity: 1 })).toBe(1);
  });

  it('关闭或减少动态时归零', () => {
    expect(resolveAudioLevel(120, { enabled: false, intensity: 1 })).toBe(0);
    expect(resolveAudioLevel(120, { reduceMotion: true, intensity: 1 })).toBe(
      0
    );
  });

  it('非法输入安全归零', () => {
    expect(resolveAudioLevel(NaN, { intensity: 0.6 })).toBe(0);
    expect(resolveAudioLevel(-5, { intensity: 0.6 })).toBe(0);
    expect(resolveAudioLevel(80, { intensity: 0 })).toBe(0);
  });
});
