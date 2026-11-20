import { describe, expect, it } from 'vitest';
import {
  createIdleFrame,
  computeFrame,
  getBinRange,
  getEnergy,
  processBand,
  smoothBand,
} from '../../src/visual/audioBands';

const BIN_HZ = 21.5; // 44.1kHz / 2048，与 folia 注释一致

const fill = (indices, value = 255, length = 1024) => {
  const data = new Uint8Array(length);
  indices.forEach(index => {
    data[index] = value;
  });
  return data;
};

describe('audioBands', () => {
  it('频段边界换算成正确的 bin 区间', () => {
    expect(getBinRange(20, 150, BIN_HZ, 1024)).toEqual([0, 6]);
    expect(getBinRange(3500, 12000, BIN_HZ, 1024)).toEqual([162, 558]);
    expect(getBinRange(20, 150, 0, 1024)).toBeNull();
    expect(getBinRange(20, 150, BIN_HZ, 0)).toBeNull();
  });

  it('getEnergy 只统计区间内平均值', () => {
    const data = fill([0, 1, 2, 3, 100]);
    // bass 区间是 bin 0..6，其中 4 个 bin 为 255
    expect(getEnergy(data, 20, 150, BIN_HZ)).toBeCloseTo((255 * 4) / 7, 5);
    expect(getEnergy(data, 150, 400, BIN_HZ)).toBe(0);
  });

  it('processBand 做幂压缩并夹在 0..255', () => {
    expect(processBand(255, 3)).toBeCloseTo(255, 5);
    expect(processBand(0, 3)).toBe(0);
    expect(processBand(128, 2)).toBeCloseTo(Math.pow(128 / 255, 2) * 255, 5);
    expect(processBand(300, 2)).toBeCloseTo(255, 5);
    expect(processBand(-1, 2)).toBe(0);
  });

  it('平滑：起音快于释放', () => {
    const attack = smoothBand(0, 200, 0.06);
    const release = smoothBand(200, 0, 0.06);
    expect(attack).toBeGreaterThan(100);
    // 释放 60ms 只掉不到一半
    expect(release).toBeGreaterThan(150);
    expect(smoothBand(100, 200, 0)).toBe(100);
  });

  it('无信号帧是 0..40 的呼吸且 active=false', () => {
    for (const now of [0, 500, 1571, 3142]) {
      const frame = createIdleFrame(now);
      expect(frame.active).toBe(false);
      expect(frame.power).toBeGreaterThanOrEqual(0);
      expect(frame.power).toBeLessThanOrEqual(40);
    }
  });

  it('全 0 数据视为播放中静音：power=0 且 active=false', () => {
    const frame = computeFrame(new Uint8Array(1024), BIN_HZ, 1000);
    expect(frame.active).toBe(false);
    expect(frame.power).toBe(0);
  });

  it('低频有能量时 power/bass > 0，高频保持 0', () => {
    const data = fill([1, 2, 3], 200);
    const frame = computeFrame(data, BIN_HZ, 1000);
    expect(frame.active).toBe(true);
    expect(frame.bands.bass).toBeGreaterThan(0);
    expect(frame.bands.treble).toBe(0);
    expect(frame.power).toBeGreaterThan(0);
  });

  it('首帧直接取目标，有历史后逐帧平滑', () => {
    // 填满整个 bass 区间（bin 0..6），目标值才会是 255
    const data = fill([0, 1, 2, 3, 4, 5, 6], 255);
    const first = computeFrame(data, BIN_HZ, 0, null, 1 / 40);
    expect(first.bands.bass).toBeCloseTo(255, 5);
    const prev = {
      power: 0,
      bands: { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 },
      active: false,
      updatedAt: 0,
    };
    const smooth1 = computeFrame(data, BIN_HZ, 25, prev, 1 / 40);
    const smooth2 = computeFrame(data, BIN_HZ, 50, smooth1, 1 / 40);
    expect(smooth1.bands.bass).toBeLessThan(255);
    expect(smooth2.bands.bass).toBeGreaterThan(smooth1.bands.bass);
  });
});
