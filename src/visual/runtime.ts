// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 视觉运行时（V0）：全局唯一的 rAF 驱动。
 *
 * 规则（docs/视觉深化计划书.md §2.2）：
 *   - 所有视觉订阅者共用一个循环，禁止组件各自 requestAnimationFrame；
 *   - 歌词页不可见 / 窗口隐藏 / 没有订阅者时**真正停止**（歌词页是常驻组件）；
 *   - 质量档决定帧率上限：high 60 / balanced 40 / low 24；
 *   - 音频分析也在这里驱动，保证同一帧里音频与视觉看到的是同一时刻。
 */
import store from '@/store';
import audioBus from './audioBus';
import type { AudioFrame } from './audioBands';

export interface VisualFrame {
  /** performance.now() / 1000（秒） */
  time: number;
  /** 距上一帧的秒数（已夹紧到 0.1s 以内） */
  dt: number;
  audio: AudioFrame;
}

export type VisualSubscriber = (frame: VisualFrame) => void;

const FPS_CAP: Record<string, number> = {
  high: 60,
  balanced: 40,
  low: 24,
};

class VisualRuntime {
  private subscribers = new Set<VisualSubscriber>();

  private rafId = 0;

  private lastRenderTs = 0;

  private pageVisible = false;

  private visibilityBound = false;

  private onVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.stop();
    } else {
      this.ensure();
    }
  };

  subscribe(fn: VisualSubscriber): () => void {
    this.subscribers.add(fn);
    this.ensure();
    return () => {
      this.subscribers.delete(fn);
      if (!this.subscribers.size) this.stop();
    };
  }

  /** 歌词页 v-show 的开关；不可见时停止循环 */
  setPageVisible(visible: boolean): void {
    this.pageVisible = Boolean(visible);
    if (this.pageVisible) {
      this.ensure();
    } else {
      this.stop();
    }
  }

  /** 调试/验收用 */
  getState() {
    return {
      running: this.rafId !== 0,
      pageVisible: this.pageVisible,
      hidden: typeof document !== 'undefined' ? document.hidden : false,
      subscribers: this.subscribers.size,
      audioKind: audioBus.getSourceKind(),
    };
  }

  private ensure(): void {
    if (typeof window === 'undefined') return;
    if (
      this.rafId ||
      !this.pageVisible ||
      document.hidden ||
      !this.subscribers.size
    ) {
      return;
    }
    this.bindVisibility();
    this.lastRenderTs = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastRenderTs = 0;
  }

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityBound = true;
  }

  private loop = (ts: number): void => {
    this.rafId = 0;
    if (
      !this.pageVisible ||
      (typeof document !== 'undefined' && document.hidden) ||
      !this.subscribers.size
    ) {
      return;
    }

    const quality = store.state.settings.visualQuality ?? 'balanced';
    const cap = FPS_CAP[quality] ?? FPS_CAP.balanced;
    const minDelta = 1000 / cap;
    if (this.lastRenderTs && ts - this.lastRenderTs < minDelta - 1) {
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }
    const dt = this.lastRenderTs
      ? Math.min(0.1, (ts - this.lastRenderTs) / 1000)
      : 1 / cap;
    this.lastRenderTs = ts;

    const audio = audioBus.update(ts, dt);
    const frame: VisualFrame = { time: ts / 1000, dt, audio };
    for (const fn of [...this.subscribers]) {
      try {
        fn(frame);
      } catch (error) {
        console.debug('[visualRuntime] subscriber failed', error);
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };
}

const visualRuntime = new VisualRuntime();

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__akiVisualRuntime', {
    value: visualRuntime,
    configurable: true,
  });
}

export default visualRuntime;
