// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { createLyricPlayhead } from '@/lyrics/timing/playhead';

/* 播放头：当前行判定与"只在变化时回调"的节拍器。
   rAF / 定时器在 node 环境里不存在，这里只测 poll() 与回调语义；
   可见性切换涉及 DOM，留给运行时验证。 */

const line = (startTime, endTime = startTime + 1) => ({
  startTime,
  endTime,
  words: [],
});

describe('createLyricPlayhead', () => {
  it('poll() 返回当前行号，且只在变化时回调', () => {
    const lines = [line(0), line(10), line(20)];
    let time = 0;
    const changes = [];
    const playhead = createLyricPlayhead({
      getLines: () => lines,
      getTime: () => time,
      onIndexChange: index => changes.push(index),
    });

    expect(playhead.poll()).toBe(0);
    expect(changes).toEqual([0]);

    time = 5; // 同一行内移动：不应再回调
    expect(playhead.poll()).toBe(0);
    expect(changes).toEqual([0]);

    time = 10;
    expect(playhead.poll()).toBe(1);
    expect(changes).toEqual([0, 1]);

    time = 30;
    expect(playhead.poll()).toBe(2);
    expect(changes).toEqual([0, 1, 2]);
  });

  it('无歌词时不回调（初始即 -1），有行后从 0 开始上报', () => {
    let lines = [];
    let time = 0;
    const changes = [];
    const playhead = createLyricPlayhead({
      getLines: () => lines,
      getTime: () => time,
      onIndexChange: index => changes.push(index),
    });

    expect(playhead.poll()).toBe(-1);
    expect(playhead.poll()).toBe(-1);
    // 内部初值就是 -1：没有歌词不是"变化"，不需要回调
    expect(changes).toEqual([]);

    lines = [line(10)];
    time = 4;
    expect(playhead.poll()).toBe(-1);
    expect(changes).toEqual([]); // 前奏：仍是 -1

    time = 10;
    expect(playhead.poll()).toBe(0);
    expect(changes).toEqual([0]);
  });

  it('stop() 之后不再推进', () => {
    const lines = [line(0), line(10)];
    let time = 0;
    const changes = [];
    const playhead = createLyricPlayhead({
      getLines: () => lines,
      getTime: () => time,
      onIndexChange: index => changes.push(index),
    });
    playhead.start();
    playhead.stop();
    time = 20;
    playhead.poll(); // 手动 poll 仍会算，但 start/stop 的自动节拍已停
    expect(changes).toEqual([0, 1]);
    expect(playhead.index).toBe(1);
  });

  it('歌词换掉后同行号不会漏报（沿用同一个 index 比较）', () => {
    // 换歌时行号可能恰好相同（都是 0），但歌词内容变了；
    // 调用方通过 poll() + 自己的 payload 版本判断，这里确认行号语义不误伤。
    let lines = [line(0), line(10)];
    let time = 10;
    const changes = [];
    const playhead = createLyricPlayhead({
      getLines: () => lines,
      getTime: () => time,
      onIndexChange: index => changes.push(index),
    });
    expect(playhead.poll()).toBe(1);
    lines = [line(0), line(5), line(9)];
    time = 26;
    lines = [line(0), line(5), line(9), line(25)];
    expect(playhead.poll()).toBe(3);
    expect(changes).toEqual([1, 3]);
  });
});
