// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach } from 'vitest';
import {
  dedupe,
  requestKey,
  inflightCount,
  clearInflight,
} from '@/utils/requestCache';

describe('dedupe（并发去重）', () => {
  beforeEach(() => clearInflight());

  it('并发请求同一 key 时只真正执行一次，结果共享', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return new Promise(resolve => setTimeout(() => resolve('result'), 10));
    };
    const [a, b, c] = await Promise.all([
      dedupe('k', fn),
      dedupe('k', fn),
      dedupe('k', fn),
    ]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual(['result', 'result', 'result']);
  });

  it('不同 key 各自执行', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.resolve(calls);
    };
    const [a, b] = await Promise.all([dedupe('a', fn), dedupe('b', fn)]);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('请求结束后立即释放：不做结果缓存，下次调用会重新执行', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.resolve(calls);
    };
    expect(await dedupe('k', fn)).toBe(1);
    expect(inflightCount()).toBe(0);
    expect(await dedupe('k', fn)).toBe(2);
  });

  it('失败也会释放，不会永久卡住该 key', async () => {
    let calls = 0;
    await expect(
      dedupe('k', () => {
        calls++;
        return Promise.reject(new Error('boom'));
      })
    ).rejects.toThrow('boom');
    expect(inflightCount()).toBe(0);
    await expect(
      dedupe('k', () => {
        calls++;
        return Promise.resolve('ok');
      })
    ).resolves.toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('requestKey（请求键归一化）', () => {
  it('参数顺序不同但语义相同 → 同一键', () => {
    expect(requestKey('x', { a: 1, b: 2 })).toBe(requestKey('x', { b: 2, a: 1 }));
  });

  it('数组参数排序后参与键（同一批 id 顺序不同视为同一请求）', () => {
    expect(requestKey('x', { ids: ['b', 'a'] })).toBe(
      requestKey('x', { ids: ['a', 'b'] })
    );
  });

  it('不同参数值产生不同键', () => {
    expect(requestKey('x', { id: 1 })).not.toBe(requestKey('x', { id: 2 }));
  });

  it('不传参数时仅返回接口标识', () => {
    expect(requestKey('x')).toBe('x');
  });
});
