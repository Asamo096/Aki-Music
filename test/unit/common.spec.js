// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 可播放性判断（isTrackPlayable / mapTrackPlayableStatus）。
 *
 * 这两个函数在 utils/common.js 里，而该模块依赖登录态与 Vuex store，
 * 因此这里把它们替换为可控的桩，单独验证「规则本身」。
 */
const ctx = { loggedIn: false, vipType: 0 };

vi.mock('@/utils/auth', () => ({
  isAccountLoggedIn: () => ctx.loggedIn,
}));
vi.mock('@/store', () => ({
  default: { state: { data: { user: {} }, settings: {} } },
}));

const store = (await import('@/store')).default;
const { isTrackPlayable, mapTrackPlayableStatus } = await import(
  '@/utils/common'
);

beforeEach(() => {
  ctx.loggedIn = false;
  ctx.vipType = 0;
  store.state.data.user.vipType = 0;
});

describe('isTrackPlayable', () => {
  it('有播放权限（privilege.pl > 0）时直接可播', () => {
    expect(isTrackPlayable({ privilege: { pl: 320000, fee: 1 } })).toEqual({
      playable: true,
      reason: '',
    });
  });

  it('未登录时 VIP 专享不可播，理由为 VIP Only', () => {
    const r = isTrackPlayable({ fee: 1, privilege: { pl: 0, fee: 1 } });
    expect(r.playable).toBe(false);
    expect(r.reason).toBe('VIP Only');
  });

  it('已登录且是黑胶会员（vipType 11）时 VIP 专享可播', () => {
    ctx.loggedIn = true;
    store.state.data.user.vipType = 11;
    expect(isTrackPlayable({ fee: 1, privilege: { pl: 0, fee: 1 } }).playable).toBe(
      true
    );
  });

  it('付费专辑（fee 4）不可播', () => {
    const r = isTrackPlayable({ fee: 4, privilege: { pl: 0, fee: 4 } });
    expect(r.playable).toBe(false);
    expect(r.reason).toBe('付费专辑');
  });

  it('无版权（noCopyrightRcmd 非空）不可播', () => {
    const r = isTrackPlayable({
      noCopyrightRcmd: { type: 1 },
      privilege: { pl: 0 },
    });
    expect(r.playable).toBe(false);
    expect(r.reason).toBe('无版权');
  });

  it('已登录时已下架（privilege.st < 0）不可播', () => {
    ctx.loggedIn = true;
    const r = isTrackPlayable({ privilege: { pl: 0, st: -200 } });
    expect(r.playable).toBe(false);
    expect(r.reason).toBe('已下架');
  });

  it('已登录时云盘歌曲（privilege.cs）可播', () => {
    ctx.loggedIn = true;
    expect(isTrackPlayable({ privilege: { pl: 0, cs: true } }).playable).toBe(
      true
    );
  });

  it('无 privilege 字段时不抛错（默认可播）', () => {
    expect(isTrackPlayable({}).playable).toBe(true);
    expect(isTrackPlayable(undefined).playable).toBe(true);
  });
});

describe('mapTrackPlayableStatus', () => {
  it('合并 privileges 并写入 playable / reason', () => {
    const tracks = [{ id: 1 }, { id: 2 }];
    const privileges = [{ id: 1, pl: 320000 }, { id: 2, pl: 0, fee: 1 }];
    const result = mapTrackPlayableStatus(tracks, privileges);
    expect(result[0].playable).toBe(true);
    expect(result[1].playable).toBe(false);
    expect(result[1].reason).toBe('VIP Only');
    expect(result[1].privilege).toMatchObject({ id: 2, pl: 0 });
  });

  it('找不到对应 privilege 时按空对象处理，不影响其它歌曲', () => {
    const result = mapTrackPlayableStatus([{ id: 9 }], []);
    expect(result[0].playable).toBe(true);
  });

  it('输入非数组时原样返回（容错）', () => {
    expect(mapTrackPlayableStatus(undefined)).toBeUndefined();
  });
});
