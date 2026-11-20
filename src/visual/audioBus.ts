// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 音频反应总线（V0）。
 *
 * 设计约束（先读 docs/视觉深化计划书.md §2.1）：
 *   1. 播放器用 `new Howl({ html5: true })`，没有现成的 Web Audio 图；
 *   2. **统一优先用 `captureStream()`**：它只是复制一路信号，不改变元素输出，
 *      播放安全，也不受 Howler 复用 html5 音频元素的影响（实测 blob 也能拿到音轨）；
 *   3. 只有 captureStream 不可用且音源是同源 blob 时，才退到
 *      `createMediaElementSource`（同一元素只能建一次，用 WeakSet 防重复）；
 *      仍然失败就返回“呼吸值”，视觉退化为纯呼吸，播放不受影响；
 *   4. AudioContext 懒创建、全局唯一；切歌只替换元素连接，不重建上下文。
 */
import { createIdleFrame, computeFrame, type AudioFrame } from './audioBands';

const FFT_SIZE = 2048;
const ANALYSER_SMOOTHING = 0.6;

type SourceKind = 'none' | 'blob' | 'remote';

const isLocalSource = (src: string): boolean =>
  src.startsWith('blob:') || src.startsWith('data:');

class AudioBus {
  private ctx: AudioContext | null = null;

  private analyser: AnalyserNode | null = null;

  private data: Uint8Array = new Uint8Array(0);

  private binHz = 0;

  private element: HTMLAudioElement | null = null;

  private stream: MediaStream | null = null;

  private streamNode: MediaStreamAudioSourceNode | null = null;

  private zeroGain: GainNode | null = null;

  private kind: SourceKind = 'none';

  private frame: AudioFrame = createIdleFrame(0);

  /** 远程音源连续无信号时长（毫秒），超过阈值回退呼吸值 */
  private silentMs = 0;

  /** 已连接但连续无数据：用于重新捕获（captureStream 早期可能拿到静音流） */
  private zeroSince = 0;

  private reconnectAttempts = 0;

  private onPlay = () => {
    this.ctx?.resume?.().catch(() => {});
  };

  private onPause = () => {};

  private retryTimers: number[] = [];

  private onMediaReady = () => {
    if (this.element && this.kind === 'none') this.connect(this.element);
  };

  /** 播放器在每次 play() 时调用；同元素重复调用是幂等的 */
  attach(howl: any): void {
    if (typeof window === 'undefined') return;
    const bind = () => {
      const el = howl?._sounds?.[0]?._node;
      if (!el || !(el instanceof HTMLAudioElement)) return;
      if (el === this.element) {
        // 媒体可能刚开始加载：上次没连上就再试一次
        if (this.kind === 'none') this.connect(el);
        return;
      }
      this.bindElement(el);
    };
    bind();
    if (!this.element && howl?.once) {
      // html5 的 Sound 可能延迟到 play 时才创建
      howl.once('play', bind);
      howl.once('load', bind);
    }
  }

  /** 切歌/卸载前断开旧元素；AudioContext 保留复用 */
  detach(): void {
    this.clearRetryTimers();
    if (this.element) {
      this.element.removeEventListener('play', this.onPlay);
      this.element.removeEventListener('pause', this.onPause);
      this.element.removeEventListener('loadedmetadata', this.onMediaReady);
      this.element.removeEventListener('canplay', this.onMediaReady);
      this.element.removeEventListener('playing', this.onMediaReady);
    }
    try {
      this.stream?.getTracks?.().forEach(track => track.stop());
      this.streamNode?.disconnect();
      this.zeroGain?.disconnect();
      this.analyser?.disconnect();
    } catch (error) {
      // 已断开的节点再次断开不应影响播放
      console.debug('[audioBus] detach failed', error);
    }
    this.streamNode = null;
    this.zeroGain = null;
    this.stream = null;
    this.element = null;
    this.kind = 'none';
    this.silentMs = 0;
  }

  /** 由 visualRuntime 的共享 rAF 驱动（约 24–60Hz） */
  update(now: number, dt: number): AudioFrame {
    const el = this.element;
    if (!el || el.paused || el.ended) {
      this.frame = createIdleFrame(now);
      return this.frame;
    }
    // 远程音源拿不到信号 / 分析不可用：用呼吸值兜底，绝不影响播放
    if (!this.analyser || this.kind === 'none') {
      this.frame = createIdleFrame(now);
      return this.frame;
    }
    try {
      this.analyser.getByteFrequencyData(this.data as Uint8Array<ArrayBuffer>);
    } catch (error) {
      console.debug('[audioBus] read spectrum failed', error);
      this.frame = createIdleFrame(now);
      return this.frame;
    }
    const frame = computeFrame(this.data, this.binHz, now, this.frame, dt);

    // captureStream 在媒体刚进入播放管线时可能给一条静音轨：
    // 持续无数据就断开重捕（最多 3 次），真实静音段落不会无限重连。
    if (frame.active) {
      this.zeroSince = 0;
      this.reconnectAttempts = 0;
    } else if (this.element && !this.element.paused) {
      if (!this.zeroSince) {
        this.zeroSince = now;
      } else if (now - this.zeroSince > 700 && this.reconnectAttempts < 3) {
        this.reconnectAttempts += 1;
        this.zeroSince = 0;
        this.reconnect();
      }
    }

    if (!frame.active && this.kind === 'remote') {
      this.silentMs += dt * 1000;
      if (this.silentMs >= 1500) {
        this.frame = createIdleFrame(now);
        return this.frame;
      }
    } else {
      this.silentMs = 0;
    }
    this.frame = frame;
    return this.frame;
  }

  getFrame(): AudioFrame {
    return this.frame;
  }

  /** 调试/验收用：当前接的是哪类音源 */
  getSourceKind(): SourceKind {
    return this.kind;
  }

  private bindElement(el: HTMLAudioElement): void {
    this.detach();
    this.element = el;
    this.zeroSince = 0;
    this.reconnectAttempts = 0;
    el.addEventListener('play', this.onPlay);
    el.addEventListener('pause', this.onPause);
    el.addEventListener('loadedmetadata', this.onMediaReady);
    el.addEventListener('canplay', this.onMediaReady);
    el.addEventListener('playing', this.onMediaReady);
    const src = el.currentSrc || el.src || '';
    this.kind = isLocalSource(src) ? 'blob' : 'remote';
    this.silentMs = 0;
    this.connect(el);
    this.scheduleConnectRetries();
  }

  /**
   * captureStream 在媒体还没加载完时会返回 0 条音轨（Chromium 行为），
   * 所以除了 loadedmetadata/canplay/playing 事件，再补几次兜底重试。
   * 每次重试都是幂等的：已连上就直接返回。
   */
  private scheduleConnectRetries(): void {
    this.clearRetryTimers();
    for (const delay of [250, 700, 1500, 3000]) {
      const timer = window.setTimeout(() => {
        this.retryTimers = this.retryTimers.filter(item => item !== timer);
        if (this.element && this.kind === 'none') this.connect(this.element);
      }, delay);
      this.retryTimers.push(timer);
    }
  }

  private clearRetryTimers(): void {
    this.retryTimers.forEach(timer => window.clearTimeout(timer));
    this.retryTimers = [];
  }

  /** 断开当前捕获/分析连接，但保留元素引用（用于重新捕获） */
  private disconnectGraph(): void {
    try {
      this.stream?.getTracks?.().forEach(track => track.stop());
      this.streamNode?.disconnect();
      this.zeroGain?.disconnect();
      this.analyser?.disconnect();
    } catch (error) {
      console.debug('[audioBus] disconnect failed', error);
    }
    this.stream = null;
    this.streamNode = null;
    this.zeroGain = null;
  }

  private reconnect(): void {
    const el = this.element;
    if (!el) return;
    console.debug('[audioBus] re-capturing silent stream');
    this.disconnectGraph();
    this.connect(el);
  }

  private connect(el: HTMLAudioElement): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.analyser) {
      this.kind = 'none';
      return;
    }
    ctx.resume?.().catch(() => {});

    // 重试时 kind 可能已被置为 none：每次连接都重新按音源判定，
    // 否则"捕获成功了但 kind 还是 none"，update() 会一直走呼吸值。
    const src = el.currentSrc || el.src || '';
    this.kind = isLocalSource(src) ? 'blob' : 'remote';

    // 只捕获、不重路由：Howler 复用元素也不会踩"同一元素只能建一次"的坑
    if (!this.tryCaptureStream(ctx, el)) this.kind = 'none';
  }

  private tryCaptureStream(ctx: AudioContext, el: HTMLAudioElement): boolean {
    const capture = (el as any).captureStream;
    if (typeof capture !== 'function') return false;
    try {
      const stream = capture.call(el) as MediaStream;
      if (!stream || !stream.getAudioTracks().length) return false;
      const node = ctx.createMediaStreamSource(stream);
      node.connect(this.analyser!);
      // analyser 需要接到输出才会被持续驱动：用 0 增益避免重复出声
      const gain = ctx.createGain();
      gain.gain.value = 0;
      this.analyser!.connect(gain);
      gain.connect(ctx.destination);
      this.stream = stream;
      this.streamNode = node;
      this.zeroGain = gain;
      return true;
    } catch (error) {
      console.debug('[audioBus] captureStream unavailable', error);
      return false;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor() as AudioContext;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this.binHz = this.ctx.sampleRate / FFT_SIZE;
    } catch (error) {
      console.debug('[audioBus] AudioContext unavailable', error);
      this.ctx = null;
      this.analyser = null;
      return null;
    }
    return this.ctx;
  }
}

const audioBus = new AudioBus();

// 运行时验收/调试入口（本地桌面应用，不影响功能）
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__akiAudioBus', {
    value: audioBus,
    configurable: true,
  });
}

export default audioBus;
