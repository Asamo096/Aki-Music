import { playlistCategories } from '@/utils/staticData';
import shortcuts from '@/utils/shortcuts';

console.debug('[debug][initLocalStorage.js]');
const enabledPlaylistCategories = playlistCategories
  .filter(c => c.enable)
  .map(c => c.name);

let localStorage = {
  player: {},
  settings: {
    lang: null,
    musicLanguage: 'all',
    appearance: 'auto',
    themeColor: 'default',
    musicQuality: 320000,
    lyricFontSize: 28,
    // 歌词字体（M2-B）。预设见 src/settings/fontStacks.ts：
    // 'app' = 沿用应用自带 Barlow（默认，观感与改造前完全一致）
    lyricsFontPreset: 'app',
    lyricsFontFamily: null,
    // 桌面歌词窗（壁纸层）的外观：由远程控制窗口的"齿轮"面板调节。
    // 真值保存在主窗口的设置里，副窗口只按 IPC 下发的快照渲染。
    desktopLyrics: {
      position: 'center',
      fontPreset: 'inherit',
      fontSize: 32,
      color: 'auto',
    },
    outputDevice: 'default',
    showPlaylistsByAppleMusic: true,
    enableUnblockNeteaseMusic: true,
    automaticallyCacheSongs: true,
    cacheLimit: 8192,
    enableReversedMode: false,
    nyancatStyle: false,
    showLyricsTranslation: true,
    lyricsBackground: true,
    // 视觉深化（V0）：质量档 / 音频反应 / 强度 / 减少动态
    // V2：visualMode = off（默认歌词页）| fume（Canvas 竖向歌词流）
    visualMode: 'off',
    /** Fume 歌词页的呈现样式：sentence（单句）/ glyph（逐字） */
    fumeStyle: 'sentence',
    visualQuality: 'balanced',
    visualAudioReactive: true,
    visualIntensity: 0.6,
    visualReduceMotion: false,
    enableOsdlyricsSupport: false,
    closeAppOption: 'ask',
    enableDiscordRichPresence: false,
    enableGlobalShortcut: true,
    showLibraryDefault: false,
    subTitleDefault: false,
    linuxEnableCustomTitlebar: false,
    trayIconTheme: 'auto',
    enabledPlaylistCategories,
    proxyConfig: {
      protocol: 'noProxy',
      server: '',
      port: null,
    },
    enableRealIP: false,
    realIP: null,
    shortcuts: shortcuts,
  },
  data: {
    user: {},
    likedSongPlaylistID: 0,
    lastRefreshCookieDate: 0,
    loginMode: null,
  },
};

if (process.env.IS_ELECTRON === true) {
  localStorage.settings.automaticallyCacheSongs = true;
}

export default localStorage;
