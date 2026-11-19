// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  buildPlayCommandSignature,
  parseListenTogetherShareLink,
  shouldApplyPlayCommand,
} from '@/utils/listenTogetherLogic';

/* ───────────────── 分享链接解析 ───────────────── */

describe('parseListenTogetherShareLink', () => {
  it('解析官方分享链接', () => {
    expect(
      parseListenTogetherShareLink(
        'https://st.music.163.com/listen-together/share/?songId=123&roomId=abc123&inviterId=456'
      )
    ).toEqual({ roomId: 'abc123', inviterId: '456' });
  });

  it('解析裸查询串', () => {
    expect(parseListenTogetherShareLink('roomId=abc123&inviterId=456')).toEqual(
      { roomId: 'abc123', inviterId: '456' }
    );
  });

  it('解析 roomId:inviterId 形式', () => {
    expect(parseListenTogetherShareLink('abc123:456')).toEqual({
      roomId: 'abc123',
      inviterId: '456',
    });
  });

  it('容错字段名（room_id / inviter_id / creatorId）', () => {
    expect(parseListenTogetherShareLink('room_id=x1&inviter_id=9')).toEqual({
      roomId: 'x1',
      inviterId: '9',
    });
    expect(
      parseListenTogetherShareLink(
        'https://st.music.163.com/listen-together/share/?roomId=x1&creatorId=9'
      )
    ).toEqual({ roomId: 'x1', inviterId: '9' });
  });

  it('拒绝多人房链接（multishare 路径 / inviterUid 参数）', () => {
    const multiId = `${'a'.repeat(32)}_1786703916799`;
    expect(
      parseListenTogetherShareLink(
        `https://st.music.163.com/listen-together/multishare/index.html?roomId=${multiId}&inviterUid=1`
      )
    ).toBe(null);
    expect(
      parseListenTogetherShareLink(
        `https://st.music.163.com/listen-together/share/?roomId=abc&inviterUid=1`
      )
    ).toBe(null);
  });

  it('接受 32位hex_时间戳 形式的房间 ID（官方 room/create 现在就用这种格式）', () => {
    const roomId = '0af7a923b79c2c06e2fbd080902bcf15_1795062926';
    expect(
      parseListenTogetherShareLink(
        `https://st.music.163.com/listen-together/share/?roomId=${roomId}&inviterId=1234567890`
      )
    ).toEqual({ roomId, inviterId: '1234567890' });
    expect(parseListenTogetherShareLink(`${roomId}:1234567890`)).toEqual({
      roomId,
      inviterId: '1234567890',
    });
  });

  it('无效输入返回 null', () => {
    expect(parseListenTogetherShareLink('')).toBe(null);
    expect(parseListenTogetherShareLink('   ')).toBe(null);
    expect(parseListenTogetherShareLink(null)).toBe(null);
    expect(parseListenTogetherShareLink('roomId=abc')).toBe(null); // 缺邀请人
    expect(parseListenTogetherShareLink('随便一句话')).toBe(null);
  });
});

/* ───────────────── 指令去重与回环防护 ───────────────── */

const command = overrides => ({
  userId: 'A',
  commandType: 'PLAY',
  targetSongId: '100',
  progress: 1000,
  playStatus: 'PLAY',
  serverSeq: 7,
  ...overrides,
});

const baseOptions = overrides => ({
  cmd: command(),
  userId: 'B', // 本机是 B，A 是房主
  sentClientSeqs: new Set(),
  lastSignature: '',
  followRoomPlayback: true,
  ...overrides,
});

describe('shouldApplyPlayCommand', () => {
  it('跟随关闭时不应用', () => {
    expect(
      shouldApplyPlayCommand(baseOptions({ followRoomPlayback: false }))
    ).toBe(false);
  });

  it('没有指令时不应用', () => {
    expect(shouldApplyPlayCommand(baseOptions({ cmd: null }))).toBe(false);
  });

  it('自己（同账号）的指令不回放', () => {
    expect(shouldApplyPlayCommand(baseOptions({ userId: 'A' }))).toBe(false);
  });

  it('同账号、自己上报过的 clientSeq 不回放（多设备同账号也能区分）', () => {
    expect(
      shouldApplyPlayCommand(
        baseOptions({
          userId: 'A',
          cmd: command({ userId: 'A', clientSeq: 42 }),
          sentClientSeqs: new Set([42]),
        })
      )
    ).toBe(false);
  });

  it('对方账号的 clientSeq 与自己的编号相同也应应用', () => {
    // clientSeq 是每个客户端各自的自增计数器，数值撞车是常态；
    // 只看编号会把房主的指令误判成自己的回声（实测：房主切歌本机不跟随）
    expect(
      shouldApplyPlayCommand(
        baseOptions({
          cmd: command({ userId: 'A', clientSeq: 7 }),
          sentClientSeqs: new Set([7, 8]),
        })
      )
    ).toBe(true);
  });

  it('同一签名只应用一次', () => {
    const cmd = command();
    const signature = buildPlayCommandSignature(cmd);
    expect(
      shouldApplyPlayCommand(baseOptions({ cmd, lastSignature: signature }))
    ).toBe(false);
    expect(
      shouldApplyPlayCommand(baseOptions({ cmd, lastSignature: 'other' }))
    ).toBe(true);
  });

  it('签名包含歌曲/进度/状态，任一变化即视为新指令', () => {
    const a = buildPlayCommandSignature(command());
    expect(a).not.toBe(buildPlayCommandSignature(command({ progress: 2000 })));
    expect(a).not.toBe(
      buildPlayCommandSignature(command({ targetSongId: '200' }))
    );
    expect(a).not.toBe(
      buildPlayCommandSignature(command({ playStatus: 'PAUSE' }))
    );
    expect(a).not.toBe(buildPlayCommandSignature(command({ serverSeq: 8 })));
  });

  it('房间指令来自对方且是新签名 → 应用', () => {
    expect(shouldApplyPlayCommand(baseOptions())).toBe(true);
  });
});
