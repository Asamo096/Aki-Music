// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { RequestScheduler, isAbortError } from '@/net/requestScheduler';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const runThatWaits = (record, label, deferreds) => signal => {
  record.push(label);
  const d = deferred();
  deferreds.set(label, d);
  return new Promise((resolve, reject) => {
    d.promise.then(resolve, reject);
    signal.addEventListener('abort', () => reject(new Error('aborted')), {
      once: true,
    });
  });
};

describe('RequestScheduler', () => {
  it('同 key 并发调用只执行一次并共享结果', async () => {
    const scheduler = new RequestScheduler();
    let calls = 0;
    const gate = deferred();
    const run = () => {
      calls++;
      return gate.promise;
    };
    const a = scheduler.schedule({ key: 'same', run, dedupe: true });
    const b = scheduler.schedule({ key: 'same', run, dedupe: true });
    await tick();
    expect(calls).toBe(1);
    gate.resolve('value');
    await expect(a).resolves.toBe('value');
    await expect(b).resolves.toBe('value');
    expect(scheduler.getStats().inflight).toBe(0);
  });

  it('请求结束后释放 key，下一次会重新执行', async () => {
    const scheduler = new RequestScheduler();
    let calls = 0;
    const run = () => Promise.resolve(++calls);
    expect(await scheduler.schedule({ key: 'k', run, dedupe: true })).toBe(1);
    expect(await scheduler.schedule({ key: 'k', run, dedupe: true })).toBe(2);
  });

  it('dedupe:false 的请求各自执行', async () => {
    const scheduler = new RequestScheduler();
    let calls = 0;
    const run = () => Promise.resolve(++calls);
    const [a, b] = await Promise.all([
      scheduler.schedule({ key: 'w', run, dedupe: false }),
      scheduler.schedule({ key: 'w', run, dedupe: false }),
    ]);
    expect([a, b]).toEqual([1, 2]);
  });

  it('P0 优先于已排队的 P2，且 P2/P3 不能占满并发', async () => {
    const scheduler = new RequestScheduler({
      maxConcurrent: 2,
      caps: { P0: 2, P1: 1, P2: 1, P3: 1 },
    });
    const started = [];
    const deferreds = new Map();
    const run = label => runThatWaits(started, label, deferreds);

    const p0a = scheduler.schedule({
      key: 'p0a',
      priority: 'P0',
      run: run('p0a'),
    });
    const p1a = scheduler.schedule({
      key: 'p1a',
      priority: 'P1',
      run: run('p1a'),
    });
    await tick();
    expect(started).toEqual(['p0a', 'p1a']);

    // P2 被自身并发上限挡住（即使全局还有槽位）
    const p2 = scheduler.schedule({
      key: 'p2',
      priority: 'P2',
      run: run('p2'),
    });
    const p0b = scheduler.schedule({
      key: 'p0b',
      priority: 'P0',
      run: run('p0b'),
    });
    await tick();
    expect(started).toEqual(['p0a', 'p1a']);

    // 释放一个槽位：应启动 P0，而不是先到队列的 P2
    deferreds.get('p1a').resolve('ok');
    await tick();
    expect(started).toEqual(['p0a', 'p1a', 'p0b']);

    deferreds.get('p0a').resolve('ok');
    deferreds.get('p0b').resolve('ok');
    await tick();
    expect(started).toEqual(['p0a', 'p1a', 'p0b', 'p2']);
    deferreds.get('p2').resolve('ok');
    await Promise.all([p0a, p1a, p2, p0b]);
  });

  it('一个调用方取消只影响自己，共享请求继续给其他人', async () => {
    const scheduler = new RequestScheduler();
    let underlyingAborted = false;
    const gate = deferred();
    const run = signal => {
      signal.addEventListener('abort', () => {
        underlyingAborted = true;
      });
      return gate.promise;
    };
    const c1 = new AbortController();
    const a = scheduler.schedule({
      key: 'shared',
      run,
      signal: c1.signal,
    });
    const b = scheduler.schedule({ key: 'shared', run });
    await tick();
    c1.abort();
    await expect(a).rejects.toSatisfy(isAbortError);
    expect(underlyingAborted).toBe(false);
    gate.resolve('still-here');
    await expect(b).resolves.toBe('still-here');
  });

  it('所有调用方取消后才中止底层请求', async () => {
    const scheduler = new RequestScheduler();
    let aborted = false;
    const c1 = new AbortController();
    const c2 = new AbortController();
    const run = signal => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise(() => {});
    };
    const a = scheduler.schedule({
      key: 'cancel-all',
      run,
      signal: c1.signal,
    });
    const b = scheduler.schedule({
      key: 'cancel-all',
      run,
      signal: c2.signal,
    });
    await tick();
    c1.abort();
    await expect(a).rejects.toSatisfy(isAbortError);
    expect(aborted).toBe(false);
    c2.abort();
    await expect(b).rejects.toSatisfy(isAbortError);
    expect(aborted).toBe(true);
  });

  it('cancelGroup 取消排队/在途任务', async () => {
    const scheduler = new RequestScheduler({
      maxConcurrent: 1,
      caps: { P0: 1, P1: 1, P2: 1, P3: 1 },
    });
    let queuedStarted = false;
    const first = deferred();
    const active = scheduler.schedule({
      key: 'active',
      priority: 'P2',
      group: 'prefetch',
      run: () => first.promise,
    });
    const queued = scheduler.schedule({
      key: 'queued',
      priority: 'P2',
      group: 'prefetch',
      run: () => {
        queuedStarted = true;
        return Promise.resolve('no');
      },
    });
    await tick();
    expect(scheduler.cancelGroup('prefetch')).toBe(2);
    await expect(active).rejects.toSatisfy(isAbortError);
    await expect(queued).rejects.toSatisfy(isAbortError);
    expect(queuedStarted).toBe(false);
  });
});
