// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 YesPlayMusic-listen-together-support（MIT）
//   src/api/listenTogether.js
// Modified for Aki Music on 2026-11-19:
//   1. 只保留**双人一起听**的 9 个接口；多人房（multi/match/*）全部删除（见计划书 §10）
//   2. 分享链接解析只接受双人房（遇到 multishare /多人房 roomId 直接拒绝）
//
// 这些接口对应网易官方客户端使用的 /api/listen/together/* 系列。
// 房间里的**实时播放指令推送**在官方客户端走网易云信(NIM)聊天室，需要原生层凭证，
// 本项目无法获取，因此只用官方 HTTP 协议：指令由本端上报，对方通过轮询
// `sync/playlist/get` 上的 `playCommand` 字段读取（见 utils/listenTogether.js）。

import request from '@/utils/request';

/** 创建一起听房间 */
export function listenTogetherRoomCreate() {
  return request({
    url: '/listentogether/room/create',
    method: 'get',
    params: { timestamp: new Date().getTime() },
  });
}

/**
 * 检查房间
 * @param {{roomId: string}} params
 */
export function listenTogetherRoomCheck(params) {
  return request({
    url: '/listentogether/room/check',
    method: 'get',
    params: { ...params, timestamp: new Date().getTime() },
  });
}

/**
 * 接受邀请 / 加入房间
 * @param {{roomId: string, inviterId: string|number}} params
 */
export function listenTogetherAccept(params) {
  return request({
    url: '/listentogether/accept',
    method: 'get',
    params: {
      refer: 'songplay_more',
      ...params,
      timestamp: new Date().getTime(),
    },
  });
}

/**
 * 结束 / 退出房间
 * @param {{roomId: string}} params
 */
export function listenTogetherEnd(params) {
  return request({
    url: '/listentogether/end',
    method: 'get',
    params: { ...params, timestamp: new Date().getTime() },
  });
}

/** 当前一起听状态（是否在房间、成员等） */
export function listenTogetherStatus() {
  return request({
    url: '/listentogether/status',
    method: 'get',
    params: { timestamp: new Date().getTime() },
  });
}

/**
 * 心跳
 * @param {{roomId: string, songId: string|number, playStatus: 'PLAY'|'PAUSE', progress: number}} params
 */
export function listenTogetherHeartbeat(params) {
  return request({
    url: '/listentogether/heatbeat',
    method: 'get',
    params: { ...params, timestamp: new Date().getTime() },
  });
}

/**
 * 上报播放指令
 * @param {{roomId: string, commandType: 'PLAY'|'PAUSE'|'GOTO'|'seek',
 *          progress: number, playStatus: 'PLAY'|'PAUSE',
 *          formerSongId: string|number, targetSongId: string|number,
 *          clientSeq: number}} params
 */
export function listenTogetherPlayCommand(params) {
  return request({
    url: '/listentogether/play/command/report',
    method: 'get',
    params: { ...params, timestamp: new Date().getTime() },
  });
}

/**
 * 获取房间当前播放列表（同时带回最近一条播放指令 `playCommand`）
 * @param {{roomId: string}} params
 */
export function listenTogetherSyncPlaylistGet(params) {
  return request({
    url: '/listentogether/sync/playlist/get',
    method: 'get',
    params: { ...params, timestamp: new Date().getTime() },
  });
}

/**
 * 上报房间播放列表变更
 * @param {{roomId: string, commandType: 'REPLACE'|'PLAYMODE_CHANGE', userId: string|number,
 *          version: number, playMode: string, randomList: string, displayList: string}} params
 */
export function listenTogetherSyncListCommand(params) {
  return request({
    url: '/listentogether/sync/list/command/report',
    method: 'get',
    params: { ...params, timestamp: new Date().getTime() },
  });
}

// 分享链接解析是纯逻辑，放在 utils/listenTogetherLogic 里以便单测；
// 这里转出，调用方仍然可以从 api 模块拿到。
export { parseListenTogetherShareLink } from '@/utils/listenTogetherLogic';
