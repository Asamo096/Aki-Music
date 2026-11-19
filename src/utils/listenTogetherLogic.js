// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 「一起听」的纯判定逻辑（不依赖 store / 播放器，便于单测）。
 *
 * 抽出原因：这些判定是整个同步机制里最容易出错、也最需要回归保护的部分
 * （自己指令的识别、同一指令去重、跟随开关），而它们本身是纯函数。
 */

/**
 * 指令签名：同一签名的指令只应用一次
 * @param {object} cmd 房间最近一条 playCommand
 * @returns {string}
 */
export const buildPlayCommandSignature = cmd =>
  [
    cmd.serverSeq ?? '',
    cmd.clientSeq ?? '',
    cmd.targetSongId ?? '',
    cmd.progress ?? '',
    cmd.playStatus ?? '',
  ].join('|');

/**
 * 是否应该把这条房间指令应用到本机播放器。
 * @param {{cmd: object|null|undefined, userId: string|number,
 *          sentClientSeqs: Set<number>, lastSignature: string,
 *          followRoomPlayback: boolean}} options
 * @returns {boolean}
 */
export const shouldApplyPlayCommand = ({
  cmd,
  userId,
  sentClientSeqs,
  lastSignature,
  followRoomPlayback,
}) => {
  if (!followRoomPlayback || !cmd) return false;
  // 同账号的指令不回放（包括同账号的其他设备）
  if (String(cmd.userId) === String(userId)) return false;
  // 自己上报的指令：clientSeq 命中才跳过。
  // **必须限定同一账号**：clientSeq 是每个客户端各自的自增计数器，
  // 对方的 clientSeq 与我们的会出现相同数值（1、2、3…）。之前不限定账号，
  // 导致房主的指令被误判成"自己的回声"而丢弃（实测：房主切歌本机不跟随）。
  if (
    cmd.clientSeq != null &&
    String(cmd.userId) === String(userId) &&
    sentClientSeqs.has(cmd.clientSeq)
  ) {
    return false;
  }
  // 同一签名只应用一次
  if (buildPlayCommandSignature(cmd) === lastSignature) return false;
  return true;
};

/**
 * 解析一起听分享输入，支持三种写法：
 *   1. 完整分享链接（https://st.music.163.com/listen-together/share/?roomId=…&inviterId=…）
 *   2. 纯查询串（roomId=…&inviterId=…）
 *   3. `roomId:inviterId`
 * 多人房链接（路径含 multishare / 使用 inviterUid）一律拒绝（本项目只做双人房）。
 * 注意：**不能用 roomId 格式判定**——官方 room/create 现在返回的也是
 * `32位hex_时间戳` 形式，与多人群房同格式。
 *
 * @param {unknown} input
 * @returns {{roomId: string, inviterId: string} | null}
 */
export function parseListenTogetherShareLink(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return null;

  // 形式 3：roomId:inviterId（roomId 可能是 `32位hex_时间戳`，官方 room/create
  // 目前就返回这种格式，**不能**据此判定为多人房）
  const pair = text.match(/^([0-9a-zA-Z_]+):(\d+)$/);
  if (pair) {
    return { roomId: pair[1], inviterId: pair[2] };
  }

  let url;
  try {
    url = new URL(
      text.includes('://')
        ? text
        : `https://st.music.163.com/listen-together/share/?${text}`
    );
  } catch {
    return null;
  }

  // 多人房链接（multishare / inviterUid）直接拒绝
  if ((url.pathname || '').includes('multishare')) return null;
  if (url.searchParams.get('inviterUid')) return null;

  const roomId =
    url.searchParams.get('roomId') ||
    url.searchParams.get('room_id') ||
    url.searchParams.get('rid') ||
    '';
  const inviterId =
    url.searchParams.get('inviterId') ||
    url.searchParams.get('inviter_id') ||
    url.searchParams.get('creatorId') ||
    url.searchParams.get('creator_id') ||
    '';

  if (!roomId || !inviterId) return null;
  return { roomId, inviterId };
}
