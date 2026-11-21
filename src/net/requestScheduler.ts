// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 统一请求调度器（P0–P3）。
 *
 * 目标不是"提高并发"，而是**保证播放关键路径不被后台任务挤占**，同时把
 * 同一时刻的重复请求合并成一次。设计约束见 docs/二开计划书.md §6.4：
 *
 *   P0 播放路径：/song/url、当前曲目详情、当前歌词
 *   P1 可见区域：页面首屏与用户主动触发的普通请求
 *   P2 预取：下一首音源/歌词/封面/详情
 *   P3 后台补齐：可随时丢弃的元数据
 *
 * 规则：
 *   - 全局最多 8 个在途请求；每档另有独立并发上限，P3 最多 1 个，
 *     后台任务无法占满全部槽位；
 *   - 同一 key 的并发调用共享同一个 Promise（结果不缓存，结束后释放）；
 *   - 每个调用方可传 AbortSignal，只影响自己；所有订阅者都取消后
 *     才真正中止底层请求；
 *   - group 用于按上下文批量取消（playback / prefetch / page:xxx）。
 */

export type RequestPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface RequestSchedulerOptions {
  maxConcurrent?: number;
  caps?: Partial<Record<RequestPriority, number>>;
}

export interface ScheduleRequestOptions<T> {
  /** 去重键；相同 key 的并发请求共享结果 */
  key: string;
  /** 默认 P1 */
  priority?: RequestPriority;
  /** 真正发请求的函数，signal 由调度器提供 */
  run: (signal: AbortSignal) => Promise<T>;
  /** 调用方取消信号：只拒绝当前调用方，不影响其他订阅者 */
  signal?: AbortSignal;
  /** 是否参与并发去重，默认 true；写请求应设为 false */
  dedupe?: boolean;
  /** 作用域标签，用于 cancelGroup */
  group?: string;
}

export interface RequestSchedulerStats {
  queued: number;
  active: number;
  inflight: number;
  /** 累计调度次数（含被去重合并的调用） */
  scheduled: number;
  /** 因同 key 已在途而被合并的次数 */
  deduped: number;
  byPriority: Record<RequestPriority, { queued: number; active: number }>;
}

const PRIORITIES: RequestPriority[] = ['P0', 'P1', 'P2', 'P3'];

const DEFAULT_CAPS: Record<RequestPriority, number> = {
  P0: 4,
  P1: 4,
  P2: 3,
  P3: 1,
};

const createAbortError = (message = 'Request aborted'): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; code?: string };
  return (
    candidate.name === 'AbortError' ||
    candidate.name === 'CanceledError' ||
    candidate.code === 'ERR_CANCELED'
  );
};

interface Entry<T> {
  seq: number;
  key: string;
  priority: RequestPriority;
  group?: string;
  run: (signal: AbortSignal) => Promise<T>;
  controller: AbortController;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  subscribers: number;
  settled: boolean;
  started: boolean;
}

export class RequestScheduler {
  private seq = 0;

  private queue: Entry<unknown>[] = [];

  private active = new Set<Entry<unknown>>();

  private inflight = new Map<string, Entry<unknown>>();

  private activeByPriority: Record<RequestPriority, number> = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
  };

  private scheduled = 0;

  private deduped = 0;

  private readonly maxConcurrent: number;

  private readonly caps: Record<RequestPriority, number>;

  constructor(options: RequestSchedulerOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 8);
    this.caps = { ...DEFAULT_CAPS, ...(options.caps || {}) };
  }

  schedule<T>(options: ScheduleRequestOptions<T>): Promise<T> {
    this.scheduled += 1;
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    const priority = options.priority ?? 'P1';
    const dedupe = options.dedupe !== false;
    const existing = dedupe ? this.inflight.get(options.key) : undefined;

    if (existing) {
      this.deduped += 1;
      // 排队的请求可以被更高优先级的重复调用"提权"
      if (
        !existing.started &&
        this.rank(priority) < this.rank(existing.priority)
      ) {
        existing.priority = priority;
      }
      return this.subscribe(existing, options.signal) as Promise<T>;
    }

    const entry = this.createEntry(options, priority, dedupe);
    if (dedupe) this.inflight.set(entry.key, entry as Entry<unknown>);
    this.queue.push(entry as Entry<unknown>);
    this.pump();
    return this.subscribe(
      entry as Entry<unknown>,
      options.signal
    ) as Promise<T>;
  }

  /** 按作用域取消；返回被取消的请求数 */
  cancelGroup(group: string): number {
    let cancelled = 0;
    for (const entry of [...this.queue]) {
      if (entry.group !== group) continue;
      this.removeFromQueue(entry);
      this.settle(entry, false, createAbortError());
      cancelled += 1;
    }
    for (const entry of [...this.active]) {
      if (entry.group !== group) continue;
      entry.controller.abort();
      // 即使底层实现不监听 signal，也要立刻让调用方拿到取消结果
      this.settle(entry, false, createAbortError());
      cancelled += 1;
    }
    return cancelled;
  }

  /** 取消全部在途/排队请求（退出登录等场景） */
  cancelAll(): number {
    let cancelled = 0;
    for (const entry of [...this.queue]) {
      this.removeFromQueue(entry);
      this.settle(entry, false, createAbortError());
      cancelled += 1;
    }
    for (const entry of [...this.active]) {
      entry.controller.abort();
      this.settle(entry, false, createAbortError());
      cancelled += 1;
    }
    return cancelled;
  }

  getStats(): RequestSchedulerStats {
    const byPriority = {} as RequestSchedulerStats['byPriority'];
    for (const priority of PRIORITIES) {
      byPriority[priority] = {
        queued: this.queue.filter(entry => entry.priority === priority).length,
        active: this.activeByPriority[priority],
      };
    }
    return {
      queued: this.queue.length,
      active: this.active.size,
      inflight: this.inflight.size,
      scheduled: this.scheduled,
      deduped: this.deduped,
      byPriority,
    };
  }

  /** 仅供测试：清空队列/在途表 */
  reset(): void {
    for (const entry of [...this.queue]) {
      this.removeFromQueue(entry);
      this.settle(entry, false, createAbortError());
    }
    for (const entry of [...this.active]) entry.controller.abort();
    this.inflight.clear();
  }

  private createEntry<T>(
    options: ScheduleRequestOptions<T>,
    priority: RequestPriority,
    dedupe: boolean
  ): Entry<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const controller = new AbortController();
    return {
      seq: ++this.seq,
      key: options.key,
      priority,
      group: options.group,
      run: options.run,
      controller,
      promise,
      resolve,
      reject,
      subscribers: 0,
      settled: false,
      started: false,
    };
  }

  /**
   * 给调用方返回独立的 Promise：某个调用方 abort 只拒绝它自己；
   * 当最后一个订阅者取消时才中止底层请求。
   */
  private subscribe<T>(entry: Entry<T>, signal?: AbortSignal): Promise<T> {
    entry.subscribers += 1;
    let finished = false;

    return new Promise<T>((resolve, reject) => {
      const cleanup = (): void => {
        if (finished) return;
        finished = true;
        entry.subscribers -= 1;
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = (): void => {
        if (finished) return;
        cleanup();
        reject(createAbortError());
        if (!entry.settled && entry.subscribers <= 0) {
          this.abortEntry(entry);
        }
      };

      entry.promise.then(
        value => {
          cleanup();
          resolve(value);
        },
        error => {
          cleanup();
          reject(error);
        }
      );

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        // addEventListener 之前已经 abort 的极端情况
        if (signal.aborted) onAbort();
      }
    });
  }

  private abortEntry<T>(entry: Entry<T>): void {
    if (entry.settled) return;
    if (entry.started) {
      entry.controller.abort();
      this.settle(entry as Entry<unknown>, false, createAbortError());
      return;
    }
    this.removeFromQueue(entry as Entry<unknown>);
    this.settle(entry as Entry<unknown>, false, createAbortError());
  }

  private pump(): void {
    while (this.active.size < this.maxConcurrent) {
      const entry = this.takeNext();
      if (!entry) break;
      this.start(entry);
    }
  }

  private takeNext(): Entry<unknown> | undefined {
    let bestIndex = -1;
    for (let i = 0; i < this.queue.length; i += 1) {
      const entry = this.queue[i];
      if (this.activeByPriority[entry.priority] >= this.caps[entry.priority]) {
        continue;
      }
      if (bestIndex < 0 || this.compare(entry, this.queue[bestIndex]) < 0) {
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return undefined;
    return this.queue.splice(bestIndex, 1)[0];
  }

  private start(entry: Entry<unknown>): void {
    entry.started = true;
    this.active.add(entry);
    this.activeByPriority[entry.priority] += 1;

    if (entry.controller.signal.aborted) {
      this.finishActive(entry);
      this.settle(entry, false, createAbortError());
      return;
    }

    Promise.resolve()
      .then(() => entry.run(entry.controller.signal))
      .then(
        value => this.settle(entry, true, value),
        error => this.settle(entry, false, error)
      );
  }

  private settle(entry: Entry<unknown>, ok: boolean, value: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.started) this.finishActive(entry);
    if (this.inflight.get(entry.key) === entry) {
      this.inflight.delete(entry.key);
    }
    if (ok) entry.resolve(value);
    else entry.reject(value);
    this.pump();
  }

  private finishActive(entry: Entry<unknown>): void {
    if (!this.active.delete(entry)) return;
    this.activeByPriority[entry.priority] = Math.max(
      0,
      this.activeByPriority[entry.priority] - 1
    );
  }

  private removeFromQueue(entry: Entry<unknown>): void {
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private rank(priority: RequestPriority): number {
    return PRIORITIES.indexOf(priority);
  }

  private compare(a: Entry<unknown>, b: Entry<unknown>): number {
    const byPriority = this.rank(a.priority) - this.rank(b.priority);
    return byPriority !== 0 ? byPriority : a.seq - b.seq;
  }
}

const requestScheduler = new RequestScheduler();

export default requestScheduler;
