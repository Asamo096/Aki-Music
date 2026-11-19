// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 歌词播放头（"当前行"节奏的唯一实现）。
 *
 * 之前三处各写了一份：
 *   - 歌词页：`setInterval(50ms)` 算 highlightLyricIndex（顺带给 Touch Bar 上报）
 *   - 桌面歌词窗：`setInterval(50ms)` 算 activeIndex
 *   - 远程控制窗：`setInterval(50ms)` 算 activeIndex
 * 逻辑相同（都是 `findActiveLineIndex`），节奏与边界处理却各写一遍，改一处容易漏另两处。
 *
 * 这里统一为：
 *   - **可见时用 rAF**：与逐字进度的驱动同频（LyricLines 的 rAF），行切换不会比字慢半拍
 *   - **不可见时退化为低频定时器**（默认 250ms）：Electron 里歌词页隐藏时仍要给
 *     Touch Bar 上报歌词；纯 rAF 在后台会被浏览器停掉
 *   - 只在**行号变化**时回调，不做无谓的状态写入
 *
 * 时间源由调用方提供（主窗口用播放器位置；副窗口用快照插值），
 * 因此"同一套节奏"指的是同一份节拍器与同一条判定逻辑，而不是同一个时钟。
 */
import { findActiveLineIndex } from './activeLine';

export interface LyricPlayheadOptions {
  /** 当前歌词行（可随换歌变化） */
  getLines: () => Array<{ startTime: number }> | null | undefined;
  /** 当前播放位置（秒） */
  getTime: () => number;
  /** 行号变化时回调（含 -1：前奏/间奏/无歌词） */
  onIndexChange: (index: number) => void;
  /** 不可见时的兜底节拍（毫秒） */
  hiddenIntervalMs?: number;
}

export interface LyricPlayhead {
  start: () => void;
  stop: () => void;
  /** 立即判定一次（换歌/歌词加载完成时用，避免等到下一拍） */
  poll: () => number;
  /** 当前行号（只读，便于调试与断言） */
  readonly index: number;
}

const DEFAULT_HIDDEN_INTERVAL_MS = 250;

export const createLyricPlayhead = ({
  getLines,
  getTime,
  onIndexChange,
  hiddenIntervalMs = DEFAULT_HIDDEN_INTERVAL_MS,
}: LyricPlayheadOptions): LyricPlayhead => {
  let index = -1;
  let running = false;
  let rafId: number | null = null;
  let timerId: ReturnType<typeof setInterval> | null = null;

  const isHidden = () =>
    typeof document !== 'undefined' && Boolean(document.hidden);
  // 非浏览器环境（单测 / 主进程复用）没有 rAF，退化为定时器
  const hasRaf = typeof requestAnimationFrame === 'function';

  const clearTimers = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const poll = (): number => {
    const next = findActiveLineIndex(getLines(), getTime());
    if (next !== index) {
      index = next;
      onIndexChange(next);
    }
    return index;
  };

  const loop = () => {
    rafId = null;
    if (!running) return;
    poll();
    if (running && !isHidden() && hasRaf) {
      rafId = requestAnimationFrame(loop);
    } else if (running) {
      // 刚好在这一帧进入后台：切成低频兜底
      startTicker();
    }
  };

  const startTicker = () => {
    clearTimers();
    if (!running) return;
    if (isHidden() || !hasRaf) {
      timerId = setInterval(poll, hiddenIntervalMs);
    } else {
      rafId = requestAnimationFrame(loop);
    }
  };

  const onVisibilityChange = () => {
    if (!running) return;
    startTicker();
    poll();
  };

  const start = () => {
    if (running) return;
    running = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    poll(); // 先同步一次，避免首帧空白
    startTicker();
  };

  const stop = () => {
    running = false;
    clearTimers();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  return {
    start,
    stop,
    poll,
    get index() {
      return index;
    },
  };
};
