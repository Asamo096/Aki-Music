// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 YesPlayMusic-listen-together-support（MIT）
//   src/utils/listenTogether.js
// Modified for Aki Music on 2026-11-19:
//   1. 只保留**双人一起听**；多人房（8s 心跳、权威队列、置顶、pin/operate）全部删除（计划书 §10）
//   2. 调试日志从「写文件」改为 console.debug（渲染进程已无 Node 能力）
//   3. 把两条防回环判定抽成纯函数（shouldApplyPlayCommand / buildPlayCommandSignature），
//      便于单测覆盖
//
// 机制说明（这些是原本最有价值的工程部分，不要简化掉）：
//   - 上报指令带自增 clientSeq；应用远端指令时忽略自己的 seq（多设备同账号也能区分）
//   - 同一条指令只应用一次：用 serverSeq|clientSeq|songId|progress|status 签名去重
//   - 跟随远端后 1.5 秒内不再回传（_remoteSuppressUntil），只盖住应用指令本身的回声，
//     避免"跟随 → 回显 → 对方又对齐"死循环，又不吞掉用户接下来的操作
//   - 进度只在**落后超过 5 秒**时向前对齐，绝不回退，避免频繁跳变
//   - 房间失效只认心跳错误码 488；其它错误只重试（网络抖动不踢人）
//   - 用户手动切歌后 20 秒内不被远端强行拉回
//   - 本地换歌上报去抖 500ms（连续自动跳歌只报最终目标）

import store from '@/store';
import {
  listenTogetherRoomCreate,
  listenTogetherRoomCheck,
  listenTogetherAccept,
  listenTogetherEnd,
  listenTogetherStatus,
  listenTogetherHeartbeat,
  listenTogetherPlayCommand,
  listenTogetherSyncPlaylistGet,
  listenTogetherSyncListCommand,
} from '@/api/listenTogether';
import { getTrackDetail } from '@/api/track';
import { isAccountLoggedIn } from '@/utils/auth';
import { UNPLAYABLE_CONDITION } from '@/utils/playbackConditions';
import {
  buildPlayCommandSignature,
  parseListenTogetherShareLink,
  shouldApplyPlayCommand,
} from '@/utils/listenTogetherLogic';

export { buildPlayCommandSignature, shouldApplyPlayCommand };

/** 官方客户端心跳间隔 20s */
const HEARTBEAT_INTERVAL = 20000;
/** 成员状态轮询（较重，慢一点） */
const STATUS_POLL_INTERVAL = 15000;
/** 播放指令/歌单轮询：自动跟随延迟的关键（验收要求 4 秒内跟随） */
const PLAYBACK_POLL_INTERVAL = 4000;
/**
 * 跟随远端后抑制回传的窗口。
 *
 * 只需要盖住"应用远端指令"本身产生的本地回调（play/pause/seek 会在同一轮里触发上报），
 * 所以 1.5 秒足够；参考实现的 20 秒会把用户接下来 20 秒内的切歌/暂停全部吞掉
 * （实测：切歌后暂停无法同步、切歌反馈延迟都由此造成）。
 */
const REMOTE_SUPPRESS_MS = 1500;
/** 用户手动切歌后的保护窗口 */
const USER_OVERRIDE_MS = 20000;
/** 进度对齐容差：只在落后超过该值时向前对齐 */
const SEEK_TOLERANCE_MS = 5000;

class ListenTogetherService {
  constructor() {
    this._roomId = '';
    this._inviterId = '';
    this._creatorId = '';
    this._roomMembers = [];
    this._roomPlaylist = [];
    this._roomPlaylistTracks = [];
    this._roomPlayCommand = null;
    this._followRoomPlayback = true;
    this._lastAppliedSignature = '';
    this._remoteSuppressUntil = 0;
    this._remoteApplying = false;
    this._userOverrideSongId = '';
    this._userOverrideUntil = 0;
    this._playlistVersion = 0;
    this._clientSeq = 0;
    this._sentClientSeqs = new Set();
    this._heartbeatTimer = null;
    this._statusTimer = null;
    this._playbackTimer = null;
    this._heartbeatFailures = 0;
    this._lastTrackId = null;
    /** GOTO 上报去抖定时器（连续跳歌时只发最终目标） */
    this._gotoTimer = null;
  }

  get inRoom() {
    return Boolean(this._roomId);
  }

  get status() {
    if (!this.inRoom) return 'alone';
    return String(this._creatorId) === String(this._userId())
      ? 'togetherOwner'
      : 'together';
  }

  _userId() {
    return store.state.data?.user?.userId ?? 0;
  }

  /** 本机是否为房主（房间以房主的播放为准） */
  get isOwner() {
    return this.inRoom && String(this._creatorId) === String(this._userId());
  }

  _commit(patch = {}) {
    store.commit('updateListenTogether', {
      inRoom: this.inRoom,
      status: this.status,
      roomId: this._roomId,
      inviterId: this._inviterId,
      creatorId: this._creatorId,
      roomMembers: [...this._roomMembers],
      roomPlaylist: [...this._roomPlaylist],
      roomPlaylistTracks: [...this._roomPlaylistTracks],
      roomPlayCommand: this._roomPlayCommand
        ? { ...this._roomPlayCommand }
        : null,
      followRoomPlayback: this._followRoomPlayback,
      playlistVersion: this._playlistVersion,
      clientSeq: this._clientSeq,
      shareLink: this.inRoom ? this._shareLink() : '',
      ...patch,
    });
  }

  _setRoomInfo(roomInfo) {
    this._roomId = roomInfo.roomId;
    this._creatorId = roomInfo.creatorId || this._inviterId || this._userId();
    this._roomMembers = (roomInfo.roomUsers || []).map(user => ({
      userId: user.userId,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
    }));
    this._lastTrackId = store.state.player?.currentTrackID ?? null;
    this._commit();
  }

  _resetState() {
    this._stopTimers();
    this._roomId = '';
    this._inviterId = '';
    this._creatorId = '';
    this._roomMembers = [];
    this._roomPlaylist = [];
    this._roomPlaylistTracks = [];
    this._roomPlayCommand = null;
    this._lastAppliedSignature = '';
    this._remoteApplying = false;
    this._userOverrideSongId = '';
    this._userOverrideUntil = 0;
    this._playlistVersion = 0;
    this._heartbeatFailures = 0;
    this._lastTrackId = null;
    this._commit({ lastError: '', syncing: false });
  }

  _startTimers() {
    this._stopTimers();
    this._heartbeatTimer = setInterval(() => {
      this._heartbeat();
    }, HEARTBEAT_INTERVAL);
    this._statusTimer = setInterval(() => {
      this.refreshStatus();
    }, STATUS_POLL_INTERVAL);
    this._playbackTimer = setInterval(() => {
      this.fetchRoomPlaylist();
    }, PLAYBACK_POLL_INTERVAL);
  }

  _stopTimers() {
    if (this._gotoTimer) {
      clearTimeout(this._gotoTimer);
      this._gotoTimer = null;
    }
    for (const key of ['_heartbeatTimer', '_statusTimer', '_playbackTimer']) {
      if (this[key]) {
        clearInterval(this[key]);
        this[key] = null;
      }
    }
  }

  _handleRoomLost(message) {
    console.debug('[listen-together] room lost:', message);
    this._resetState();
    store.dispatch('showToast', message || '一起听房间已失效');
  }

  /** 创建房间（与官方客户端共用同一批房间） */
  async createRoom() {
    if (!isAccountLoggedIn()) {
      store.dispatch('showToast', '一起听需要登录网易云账号');
      return { ok: false, message: 'not-logged-in' };
    }
    if (this.inRoom) return { ok: false, message: 'already-in-room' };

    store.commit('updateListenTogether', { syncing: true, lastError: '' });
    try {
      const res = await listenTogetherRoomCreate();
      if (res.code !== 200 || !res.data || !res.data.roomInfo) {
        const message = res.message || '创建房间失败';
        store.commit('updateListenTogether', {
          syncing: false,
          lastError: message,
        });
        store.dispatch('showToast', message);
        return { ok: false, message };
      }
      this._inviterId = String(this._userId());
      this._setRoomInfo(res.data.roomInfo);
      store.commit('updateListenTogether', { syncing: false, lastError: '' });
      store.dispatch('showToast', '创建房间成功，把分享链接发给好友吧');
      this._startTimers();
      // 把当前播放列表同步进房间
      this.syncCurrentPlaylist();
      return { ok: true, roomId: this._roomId, shareLink: this._shareLink() };
    } catch (error) {
      const message = '创建房间失败，请稍后重试';
      store.commit('updateListenTogether', {
        syncing: false,
        lastError: message,
      });
      store.dispatch('showToast', message);
      console.warn('[listen-together] create failed', error);
      return { ok: false, message };
    }
  }

  /**
   * 通过分享链接 / `roomId:inviterId` 加入房间
   */
  async joinRoom(input) {
    if (!isAccountLoggedIn()) {
      store.dispatch('showToast', '一起听需要登录网易云账号');
      return { ok: false, message: 'not-logged-in' };
    }
    const parsed = parseListenTogetherShareLink(input);
    if (!parsed) {
      store.dispatch('showToast', '无法解析分享链接（只支持双人一起听）');
      return { ok: false, message: 'bad-input' };
    }
    if (this.inRoom) return { ok: false, message: 'already-in-room' };

    store.commit('updateListenTogether', { syncing: true, lastError: '' });
    try {
      // 先检查房间是否还能加入（失效 / 已满 时给出明确提示）
      const check = await listenTogetherRoomCheck({ roomId: parsed.roomId });
      if (
        check.data &&
        check.data.joinable === false &&
        check.data.status !== 'AVAILABLE'
      ) {
        const message = check.data.copywriting || '房间已失效，无法加入';
        store.commit('updateListenTogether', {
          syncing: false,
          lastError: message,
        });
        store.dispatch('showToast', message);
        return { ok: false, message };
      }

      const accept = await listenTogetherAccept({
        roomId: parsed.roomId,
        inviterId: parsed.inviterId,
      });
      if (accept.code !== 200) {
        const message = accept.message || '加入房间失败';
        store.commit('updateListenTogether', {
          syncing: false,
          lastError: message,
        });
        store.dispatch('showToast', message);
        return { ok: false, message };
      }
      this._inviterId = String(parsed.inviterId);
      this._roomId = String(parsed.roomId);

      // 拉一次成员/房间信息（失败不阻塞，成员列表由轮询补齐）
      try {
        const status = await listenTogetherStatus();
        const roomInfo = status.data?.roomInfo;
        if (roomInfo) {
          this._setRoomInfo(roomInfo);
        } else {
          this._commit();
        }
      } catch {
        this._commit();
      }

      store.commit('updateListenTogether', { syncing: false, lastError: '' });
      store.dispatch('showToast', '已加入一起听房间');
      this._startTimers();
      // 立刻拉一次房间状态（当前播放 + 歌单）
      this.fetchRoomPlaylist();
      return { ok: true, roomId: this._roomId };
    } catch (error) {
      const message = '加入房间失败，请检查链接是否有效';
      store.commit('updateListenTogether', {
        syncing: false,
        lastError: message,
      });
      store.dispatch('showToast', message);
      console.warn('[listen-together] join failed', error);
      return { ok: false, message };
    }
  }

  /** 退出房间（先停定时器，再尽力通知服务端） */
  async leaveRoom({ silent = false } = {}) {
    const roomId = this._roomId;
    this._stopTimers();
    this._resetState();
    if (roomId) {
      try {
        await listenTogetherEnd({ roomId });
      } catch (error) {
        // 结束失败也照常退出本地状态
        console.warn('[listen-together] end failed', error);
      }
    }
    if (!silent) store.dispatch('showToast', '已退出一起听');
    return { ok: true };
  }

  /** 刷新成员列表 */
  async refreshStatus() {
    if (!this.inRoom) return;
    try {
      const res = await listenTogetherStatus();
      if (res.code !== 200 || !res.data) return;
      // 房间是否失效以心跳 488 为准，这里只更新成员
      if (res.data.inRoom === false) return;
      const roomInfo = res.data.roomInfo;
      if (roomInfo && Array.isArray(roomInfo.roomUsers)) {
        this._roomMembers = roomInfo.roomUsers.map(user => ({
          userId: user.userId,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl,
        }));
        this._commit();
      }
    } catch (error) {
      console.debug('[listen-together] status failed', error);
    }
  }

  async _heartbeat() {
    if (!this.inRoom) return;
    const player = store.state.player;
    const songId = player?.currentTrackID;
    if (!songId) return;
    const playStatus = player?.playing ? 'PLAY' : 'PAUSE';
    const progress = Math.max(1, Math.floor((player?.seek?.() ?? 0) * 1000));

    try {
      const res = await listenTogetherHeartbeat({
        roomId: this._roomId,
        songId,
        playStatus,
        progress,
      });
      if (res.code === 200 && res.data && res.data.result) {
        this._heartbeatFailures = 0;
        return;
      }
      this._heartbeatFailures += 1;
      // 只有服务端明确返回 488 才判定房间失效
      if (res.code === 488) this._handleRoomLost(res.message);
    } catch (error) {
      this._heartbeatFailures += 1;
      console.debug('[listen-together] heartbeat failed', error);
    }
  }

  /**
   * 上报播放指令（用户在本机的播放/暂停/切歌/拖动进度）
   */
  async reportPlayCommand(commandType, options = {}) {
    if (!this.inRoom) return;
    const player = store.state.player;
    const targetSongId = options.targetSongId ?? player?.currentTrackID ?? '';
    if (!targetSongId) return;

    const formerSongId = options.formerSongId ?? this._lastTrackId ?? -1;
    const progress = Math.max(
      0,
      Math.floor((options.progress ?? player?.seek?.() ?? 0) * 1000)
    );
    const playStatus = commandType === 'PAUSE' ? 'PAUSE' : 'PLAY';

    this._clientSeq += 1;
    this._sentClientSeqs.add(this._clientSeq);
    if (this._sentClientSeqs.size > 200) this._sentClientSeqs.clear();

    try {
      await listenTogetherPlayCommand({
        roomId: this._roomId,
        commandType,
        progress,
        playStatus,
        formerSongId,
        targetSongId,
        clientSeq: this._clientSeq,
      });
    } catch (error) {
      // 上报失败不打断本地播放
      console.debug('[listen-together] report failed', error);
    }
    this._lastTrackId = targetSongId;
    this._commit({ clientSeq: this._clientSeq });
  }

  /** 把本机当前播放列表推给房间（REPLACE） */
  async syncCurrentPlaylist() {
    if (!this.inRoom) return false;
    const player = store.state.player;
    const list = (player?.list || []).map(String).filter(Boolean);
    if (!list.length) return false;

    const playMode =
      player?.repeatMode === 'one'
        ? 'SINGLE_LOOP'
        : player?.shuffle
        ? 'RANDOM'
        : 'ORDER_LOOP';
    this._playlistVersion += 1;
    try {
      const res = await listenTogetherSyncListCommand({
        roomId: this._roomId,
        commandType: 'REPLACE',
        userId: this._userId(),
        version: this._playlistVersion,
        playMode,
        randomList: list.join(','),
        displayList: list.join(','),
      });
      if (res.code === 200 && res.data && res.data.result) {
        this._commit({ playlistVersion: this._playlistVersion });
        return true;
      }
      store.dispatch('showToast', res.message || '播放列表同步失败');
      return false;
    } catch (error) {
      console.debug('[listen-together] playlist sync failed', error);
      store.dispatch('showToast', '播放列表同步失败');
      return false;
    }
  }

  /**
   * 轮询房间状态：最近一条播放指令 + 房间歌单。
   * 这是"跟随"的唯一来源（官方实时通道走 NIM，本项目用不了）。
   */
  async fetchRoomPlaylist() {
    if (!this.inRoom) return;
    try {
      const res = await listenTogetherSyncPlaylistGet({
        roomId: this._roomId,
      });
      if (res.code !== 200 || !res.data) return;

      if (res.data.playCommand) {
        const cmd = res.data.playCommand;
        this._roomPlayCommand = {
          userId: cmd.userId,
          commandType: cmd.commandType,
          targetSongId: String(cmd.targetSongId),
          progress: cmd.progress,
          playStatus: cmd.playStatus,
          serverSeq: cmd.serverSeq,
          clientSeq: cmd.clientSeq,
        };
        this._commit({ roomPlayCommand: this._roomPlayCommand });
        this._applyRoomPlayback();
      }

      // 兼容 playList / playlist 两种结构
      const playlistData = res.data.playList || res.data.playlist || res.data;
      const displayList =
        playlistData.displayList?.result ?? playlistData.displayList;
      const newList = Array.isArray(displayList) ? displayList.map(String) : [];

      if (newList.join(',') !== this._roomPlaylist.join(',')) {
        this._roomPlaylist = newList;
        this._commit({ roomPlaylist: newList });
        if (newList.length) {
          try {
            const detail = await getTrackDetail(newList.join(','));
            this._roomPlaylistTracks = detail.songs || [];
            this._commit({ roomPlaylistTracks: this._roomPlaylistTracks });
          } catch (error) {
            // 详情拉取失败不影响房间状态
            console.debug('[listen-together] room tracks failed', error);
          }
        }
      }
    } catch (error) {
      // 忽略，下次刷新
      console.debug('[listen-together] poll failed', error);
    }
  }

  /** 按房间指令跟随播放（防回环见文件头说明） */
  async _applyRoomPlayback() {
    const cmd = this._roomPlayCommand;
    const shouldApply = shouldApplyPlayCommand({
      cmd,
      userId: this._userId(),
      sentClientSeqs: this._sentClientSeqs,
      lastSignature: this._lastAppliedSignature,
      followRoomPlayback: this._followRoomPlayback,
    });
    if (!shouldApply) return;

    this._lastAppliedSignature = buildPlayCommandSignature(cmd);
    const player = store.state.player;
    if (!player) return;

    // 用户手动切歌保护窗口：不把本地强行拉回旧歌
    if (
      this._userOverrideSongId &&
      Date.now() < this._userOverrideUntil &&
      String(this._userOverrideSongId) !== cmd.targetSongId
    ) {
      return;
    }
    if (
      this._userOverrideSongId &&
      (String(this._userOverrideSongId) === cmd.targetSongId ||
        Date.now() >= this._userOverrideUntil)
    ) {
      this._userOverrideSongId = '';
      this._userOverrideUntil = 0;
    }

    // 跟随产生的本地动作在抑制窗口内不再回传
    this._remoteSuppressUntil = Date.now() + REMOTE_SUPPRESS_MS;

    const currentId = String(player.currentTrackID ?? '');
    if (cmd.targetSongId && cmd.targetSongId !== currentId) {
      this._remoteApplying = true;
      try {
        // 第三参 STOP：房间指定的歌本机放不了时**不要自动跳走**，
        // 否则本地进度会偏离房间（VIP 曲目在未登录/无版权时会走到这里）
        await player._replaceCurrentTrack(
          cmd.targetSongId,
          true,
          UNPLAYABLE_CONDITION.STOP
        );
      } catch (error) {
        console.debug('[listen-together] remote track failed', error);
      } finally {
        this._remoteApplying = false;
      }
      this._lastTrackId = cmd.targetSongId;
    }

    if (cmd.playStatus === 'PAUSE' && player.playing) {
      player.pause();
    } else if (cmd.playStatus === 'PLAY' && !player.playing) {
      player.play();
    }

    // 进度只在落后超过容差时向前对齐（绝不回退）
    if (
      cmd.targetSongId === currentId &&
      typeof cmd.progress === 'number' &&
      cmd.playStatus !== 'PAUSE'
    ) {
      const localMs = Math.floor((player.seek?.() ?? 0) * 1000);
      if (cmd.progress - localMs > SEEK_TOLERANCE_MS) {
        player.seek(Math.max(0, cmd.progress / 1000));
      }
    }
  }

  toggleFollowRoomPlayback() {
    this._followRoomPlayback = !this._followRoomPlayback;
    this._commit();
  }

  _shareLink() {
    return (
      'https://st.music.163.com/listen-together/share/?' +
      `songId=${store.state.player?.currentTrackID ?? ''}` +
      `&roomId=${this._roomId}&inviterId=${this._inviterId}`
    );
  }

  /* ── 播放器钩子 ── */

  /**
   * 换歌上报（去抖）。
   *
   * 为什么去抖：不可播放的曲目会让播放器连续跳到下一首，每次跳都触发这里；
   * 若逐次上报，对方会跟着跳成一串，最后停在与本机不同的歌上（实测"播放的音乐不一致"）。
   * 这里等 500ms 内的连续切换停下来，只报最终的目标歌曲。
   */
  onTrackChange() {
    if (!this.inRoom || this._remoteApplying) return;
    const trackId = store.state.player?.currentTrackID;
    if (!trackId || trackId === this._lastTrackId) return;

    // 用户手动切歌：20 秒内不被远端强行拉回（参考实现的用户覆盖窗口）
    this._userOverrideSongId = String(trackId);
    this._userOverrideUntil = Date.now() + USER_OVERRIDE_MS;

    if (this._gotoTimer) clearTimeout(this._gotoTimer);
    this._gotoTimer = setTimeout(() => {
      this._gotoTimer = null;
      const finalTrackId = store.state.player?.currentTrackID;
      if (!finalTrackId) return;
      this.reportPlayCommand('GOTO', {
        formerSongId: this._lastTrackId ?? -1,
        targetSongId: finalTrackId,
      });
    }, 500);
  }

  /** 立刻发出待发的 GOTO（避免顺序错乱：先切歌再暂停） */
  async _flushPendingGoto() {
    if (!this._gotoTimer) return;
    clearTimeout(this._gotoTimer);
    this._gotoTimer = null;
    const trackId = store.state.player?.currentTrackID;
    if (trackId) {
      await this.reportPlayCommand('GOTO', {
        formerSongId: this._lastTrackId ?? -1,
        targetSongId: trackId,
      });
    }
  }

  onPlay() {
    if (!this.inRoom || Date.now() < this._remoteSuppressUntil) return;
    this._flushPendingGoto();
    this.reportPlayCommand('PLAY');
  }

  async onPause() {
    if (!this.inRoom || Date.now() < this._remoteSuppressUntil) return;
    await this._flushPendingGoto();
    this.reportPlayCommand('PAUSE');
  }

  async onSeek() {
    if (!this.inRoom || Date.now() < this._remoteSuppressUntil) return;
    await this._flushPendingGoto();
    this.reportPlayCommand('seek');
  }
}

const listenTogetherService = new ListenTogetherService();

export default listenTogetherService;
