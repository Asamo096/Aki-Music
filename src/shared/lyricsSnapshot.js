// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 主窗口 → 副窗口（桌面歌词 / 远程控制）的同步契约。
 *
 * 设计要点（与 folia 的差异，写在这里以免两边理解不一致）：
 *   - folia 每 500ms 推一次**完整快照**（含整份 LyricData）。歌词数组通常几十到上百 KB，
 *     每秒推两次纯属浪费；这里拆成两条流：
 *       payload（歌词正文）—— **变更时**才发（换歌 / 歌词加载完成）
 *       state（播放态 + 样式）—— 500ms 心跳，体积只有几十字节
 *   - 副窗口自己用 `getSnapshotTime()` 插值时钟（两次心跳之间不跳字），
 *     并自行用 rAF 改 DOM，避免为了进度条/歌词高亮跑 IPC
 *   - 主进程只做缓存与转发，不做任何歌词解析
 */

export const CHANNELS = {
  /** 渲染进程 → 主进程：歌词正文（变更时） */
  payload: 'lyrics-payload',
  /** 渲染进程 → 主进程：播放态与样式（约 500ms） */
  state: 'lyrics-state',
  /** 渲染进程 → 主进程：开/关桌面歌词（INVOKE，返回状态） */
  toggle: 'desktop-lyrics:toggle',
  /** 渲染进程 → 主进程：查询当前状态（INVOKE） */
  query: 'desktop-lyrics:query',
  /** 主进程 → 渲染进程：状态变化 */
  status: 'desktop-lyrics:status',

  /** 渲染进程（远程窗口）→ 主进程 → 主窗口：播放命令 */
  remoteCommand: 'remote-command',
  /** 渲染进程（主窗口）→ 主进程：开/关远程控制（INVOKE） */
  remoteToggle: 'remote:toggle',
  /** 主进程 → 主窗口：远程窗口状态 */
  remoteStatus: 'remote:status',
  /** 渲染进程（远程窗口）→ 主进程：点击穿透开关（INVOKE） */
  remoteClickThrough: 'remote:click-through',
  /** 渲染进程（远程窗口）→ 主进程：最大化/还原（INVOKE） */
  remoteMaximize: 'remote:maximize',
  /** 渲染进程（远程窗口）→ 主进程 → 主窗口：桌面歌词的外观设置 */
  desktopSettings: 'desktop-lyrics:settings',
};

/* ── 桌面歌词窗的外观设置（由远程窗口的"齿轮"面板修改，主窗口持有真值）── */

export const DESKTOP_LYRICS_POSITIONS = ['top', 'center', 'bottom'];
/** inherit = 跟随歌词页的字体设置 */
export const DESKTOP_LYRICS_FONT_PRESETS = [
  'inherit',
  'app',
  'sans',
  'serif',
  'mono',
  /** 指定某个本机字体（family 字段承载字体名） */
  'custom',
];

export const DESKTOP_LYRICS_DEFAULTS = {
  position: 'center',
  fontPreset: 'inherit',
  /** fontPreset === 'custom' 时使用的字体族名 */
  fontFamily: null,
  fontSize: 32,
  /** 'auto' = 用封面主色；否则是 #rrggbb */
  color: 'auto',
};

const clampFontSize = value => {
  const size = Number(value);
  if (!Number.isFinite(size)) return DESKTOP_LYRICS_DEFAULTS.fontSize;
  return Math.min(72, Math.max(16, Math.round(size / 2) * 2));
};

const normalizeColor = value => {
  if (typeof value !== 'string') return DESKTOP_LYRICS_DEFAULTS.color;
  if (value === 'auto') return 'auto';
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DESKTOP_LYRICS_DEFAULTS.color;
};

/** 逐字段校验：IPC 数据不可信，任何脏值都回落到默认值 */
export const normalizeDesktopLyricsSettings = (value = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    position: DESKTOP_LYRICS_POSITIONS.includes(source.position)
      ? source.position
      : DESKTOP_LYRICS_DEFAULTS.position,
    fontPreset: DESKTOP_LYRICS_FONT_PRESETS.includes(source.fontPreset)
      ? source.fontPreset
      : DESKTOP_LYRICS_DEFAULTS.fontPreset,
    fontFamily:
      typeof source.fontFamily === 'string' && source.fontFamily.trim()
        ? source.fontFamily.trim()
        : null,
    fontSize: clampFontSize(source.fontSize),
    color: normalizeColor(source.color),
  };
};

/**
 * 点击穿透的**解锁热区**（单一来源）。
 *
 * folia 在主进程与渲染进程各存一份常量，靠人工保持一致；这里只保留这一份，
 * 主进程轮询光标与渲染进程命中测试都引用它，避免两边漂移导致
 * "看得见解锁按钮却点不动"。
 *
 * 坐标约定：窗口客户区的 CSS 像素（DIP），原点为窗口左上角。
 */
export const UNLOCK_HOTSPOT = {
  width: 84,
  height: 40,
  /** 距窗口右上角的偏移（0 = 贴着右上角） */
  top: 0,
  right: 0,
};

/** 主进程轮询光标的间隔（毫秒） */
export const CLICK_THROUGH_POLL_MS = 150;

/**
 * 判断一个窗口内坐标是否落在解锁热区里。
 * @param {{x:number,y:number}} point 窗口客户区坐标（DIP）
 * @param {{width:number,height:number}} size 窗口客户区尺寸（DIP）
 */
export const isInUnlockHotspot = (point, size) => {
  if (!point || !size) return false;
  const left = size.width - UNLOCK_HOTSPOT.right - UNLOCK_HOTSPOT.width;
  const top = UNLOCK_HOTSPOT.top;
  return (
    point.x >= left &&
    point.x <= left + UNLOCK_HOTSPOT.width &&
    point.y >= top &&
    point.y <= top + UNLOCK_HOTSPOT.height
  );
};

/** state 心跳间隔 */
export const STATE_INTERVAL_MS = 500;
/** 壁纸层挂载健康检查间隔 */
export const WALLPAPER_HEARTBEAT_MS = 5000;
/** 挂载丢失后的最大重挂次数，超过则自动关窗并回报原因 */
export const MAX_REATTACH_ATTEMPTS = 3;

/** 副窗口加载时用哪个查询参数区分身份 */
export const WINDOW_QUERY_KEY = 'win';
export const WINDOW_DESKTOP_LYRICS = 'desktop-lyrics';
export const WINDOW_REMOTE = 'remote';

/**
 * 时钟插值：两次心跳之间按"上一次位置 + 已流逝时间"估算当前位置。
 * 暂停时直接用上报位置。
 */
export const getSnapshotTime = (state, now = Date.now()) => {
  if (!state || typeof state.position !== 'number') return 0;
  if (!state.playing) return state.position;
  const elapsed = Math.max(0, (now - (state.at ?? now)) / 1000);
  return state.position + elapsed;
};

/** 校验主窗口发来的正文载荷（防御：IPC 数据不可信） */
export const isPayloadValid = payload =>
  Boolean(
    payload &&
      Number.isFinite(payload.version) &&
      Array.isArray(payload.lines) &&
      payload.lines.every(
        line =>
          line &&
          typeof line.startTime === 'number' &&
          typeof line.endTime === 'number' &&
          Array.isArray(line.words)
      ) &&
      payload.style &&
      typeof payload.style.fontFamily === 'string'
  );

/** 校验状态载荷 */
export const isStateValid = state =>
  Boolean(
    state &&
      typeof state.position === 'number' &&
      typeof state.playing === 'boolean' &&
      state.at
  );
