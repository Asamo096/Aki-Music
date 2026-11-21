'use strict';
import {
  app,
  BrowserWindow,
  shell,
  dialog,
  globalShortcut,
  nativeTheme,
  screen,
  session,
  ipcMain,
} from 'electron';
import {
  isWindows,
  isMac,
  isLinux,
  isDevelopment,
  isCreateTray,
  isCreateMpris,
} from '@/utils/platform';
import { startNeteaseMusicApi } from './electron/services';
import { initIpcMain } from './electron/ipcMain.js';
import { createMenu } from './electron/menu';
import { createTray } from '@/electron/tray';
import { createTouchBar } from './electron/touchBar';
import { createDockMenu } from './electron/dockMenu';
import { registerGlobalShortcut } from './electron/globalShortcut';
import { autoUpdater } from 'electron-updater';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';
import { EventEmitter } from 'events';
import express from 'express';
import expressProxy from 'express-http-proxy';
import axios from 'axios';
import Store from 'electron-store';
import { createMpris, createDbus } from '@/electron/mpris';
import {
  closeDesktopLyrics,
  disposeDesktopLyrics,
  getDesktopLyricsStatus,
  getCachedSnapshot,
  isDesktopLyricsSender,
  openDesktopLyrics,
  cacheSnapshot,
  setStatusReporter,
} from '@/electron/desktopLyricsWindow';
import {
  cacheRemoteSnapshot,
  disposeRemote,
  getRemoteCachedSnapshot,
  initRemoteIpc,
  isRemoteSender,
  setRemoteStatusReporter,
} from '@/electron/remoteWindow';
import { describeDesktop } from '@/electron/wallpaper';
import { CHANNELS } from '@/shared/lyricsSnapshot';
import { PRODUCT_NAME, RELEASES_URL } from '@/config/app';
import { spawn } from 'child_process';
import path from 'node:path';
const clc = require('cli-color');
const log = text => {
  console.log(`${clc.blueBright('[background.js]')} ${text}`);
};

const closeOnLinux = (e, win, store) => {
  let closeOpt = store.get('settings.closeAppOption');
  if (closeOpt !== 'exit') {
    e.preventDefault();
  }

  if (closeOpt === 'ask') {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Information',
        cancelId: 2,
        defaultId: 0,
        message: '确定要关闭吗？',
        buttons: ['最小化到托盘', '直接退出'],
        checkboxLabel: '记住我的选择',
      })
      .then(result => {
        if (result.checkboxChecked && result.response !== 2) {
          win.webContents.send(
            'rememberCloseAppOption',
            result.response === 0 ? 'minimizeToTray' : 'exit'
          );
        }

        if (result.response === 0) {
          win.hide(); //调用 最小化实例方法
        } else if (result.response === 1) {
          win = null;
          app.exit(); //exit()直接关闭客户端，不会执行quit();
        }
      })
      .catch(err => {
        log(err);
      });
  } else if (closeOpt === 'exit') {
    win = null;
    app.quit();
  } else {
    win.hide();
  }
};

class Background {
  constructor() {
    this.window = null;
    this.ypmTrayImpl = null;
    this.store = new Store({
      windowWidth: {
        width: { type: 'number', default: 1440 },
        height: { type: 'number', default: 840 },
      },
    });
    this.neteaseMusicAPI = null;
    this.expressApp = null;
    this.willQuitApp = !isMac;

    this.init();
  }

  init() {
    log('initializing');

    // Make sure the app is singleton.
    if (!app.requestSingleInstanceLock()) return app.quit();

    // start netease music api
    this.neteaseMusicAPI = startNeteaseMusicApi();

    // create Express app
    this.createExpressApp();

    // 说明：上游在此注册 app:// 特权协议，供 vue-cli-plugin-electron-builder 的
    // createProtocol() 使用。本项目改由本地 express（27232 端口）提供渲染产物，
    // 不再需要自定义协议，故连同 createProtocol 一起移除。

    // handle app events
    this.handleAppEvents();

    // disable chromium mpris
    if (isCreateMpris) {
      app.commandLine.appendSwitch(
        'disable-features',
        'HardwareMediaKeyHandling,MediaSessionService'
      );
    }
  }

  async initDevtools() {
    // Install Vue Devtools extension
    try {
      await installExtension(VUEJS_DEVTOOLS);
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString());
    }

    // Exit cleanly on request from parent process in development mode.
    if (isWindows) {
      process.on('message', data => {
        if (data === 'graceful-exit') {
          app.quit();
        }
      });
    } else {
      process.on('SIGTERM', () => {
        app.quit();
      });
    }
  }

  createExpressApp() {
    log('creating express app');

    const expressApp = express();

    // CDN 转发端点。
    //
    // 渲染进程已开启 webSecurity，无法再跨源 XHR 网易云 CDN（音频缓存与封面
    // 预热都是 XHR，img/audio 标签不受影响）。这里做同源转发。
    //
    // 域名白名单是必须的：本服务监听在 localhost，若不校验目标就会变成
    // 任意可达的开放代理。
    const ALLOWED_PROXY_HOSTS = [
      /\.music\.126\.net$/i, // 网易云音频与封面
      /\.bilivideo\.com$/i, // UnblockNeteaseMusic 的 bilibili 音源
    ];
    expressApp.get('/proxy', async (req, res) => {
      const target = req.query.url;
      if (typeof target !== 'string') return res.status(400).end();

      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        return res.status(400).end();
      }

      const allowed =
        parsed.protocol === 'https:' &&
        ALLOWED_PROXY_HOSTS.some(re => re.test(parsed.hostname));
      if (!allowed) {
        log(`[proxy] 拒绝非白名单目标: ${parsed.hostname}`);
        return res.status(403).end();
      }

      try {
        const upstream = await axios.get(target, {
          responseType: 'stream',
          timeout: 30000,
          // 透传 Range 以便后续按需分段读取
          headers: req.headers.range ? { Range: req.headers.range } : {},
          validateStatus: s => s >= 200 && s < 400,
        });
        res.status(upstream.status);
        for (const h of [
          'content-type',
          'content-length',
          'accept-ranges',
          'content-range',
          'cache-control',
          'etag',
          'last-modified',
        ]) {
          const v = upstream.headers[h];
          if (v !== undefined) res.setHeader(h, v);
        }
        upstream.data.on('error', () => res.destroy());
        upstream.data.pipe(res);
      } catch (err) {
        log(`[proxy] 转发失败: ${err.message}`);
        if (!res.headersSent) res.status(502).end();
      }
    });

    // 渲染进程产物目录：`vite build --mode electron` 输出到 dist/，
    // 而本文件构建后位于 dist-electron/，因此渲染产物在 ../dist。
    expressApp.use('/', express.static(path.join(__dirname, '..', 'dist')));
    expressApp.use('/api', expressProxy('http://127.0.0.1:10754'));
    expressApp.use('/player', (req, res) => {
      this.window.webContents
        .executeJavaScript('window.yesplaymusic.player')
        .then(result => {
          res.send({
            currentTrack: result._isPersonalFM
              ? result._personalFMTrack
              : result._currentTrack,
            progress: result._progress,
          });
        });
    });
    this.expressApp = expressApp.listen(27232, '127.0.0.1');
  }

  createWindow() {
    log('creating app window');

    const appearance = this.store.get('settings.appearance');
    const showLibraryDefault = this.store.get('settings.showLibraryDefault');

    const options = {
      width: this.store.get('window.width') || 1440,
      height: this.store.get('window.height') || 840,
      minWidth: 1080,
      minHeight: 720,
      titleBarStyle: 'hiddenInset',
      frame: !(
        isWindows ||
        (isLinux && this.store.get('settings.linuxEnableCustomTitlebar'))
      ),
      title: PRODUCT_NAME,
      show: false,
      webPreferences: {
        // 安全模型（M1b）：渲染进程不再拥有任何 Node 能力，
        // 需要主进程能力时只能走 preload 暴露的白名单桥（见 src/preload.js）。
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // 开启同源策略。渲染进程原先直连网易云 CDN 的 XHR（音频/封面缓存）
        // 因此改为经本地 27232 的 /proxy 转发。
        webSecurity: true,
        // TODO(M1b 后续): 评估开启 sandbox。当前 preload 只用 contextBridge 与
        // ipcRenderer，理论上可在沙箱内运行；先保持 false 以缩小本次改动面。
        sandbox: false,
      },
      backgroundColor:
        ((appearance === undefined || appearance === 'auto') &&
          nativeTheme.shouldUseDarkColors) ||
        appearance === 'dark'
          ? '#222'
          : '#fff',
    };

    if (this.store.get('window.x') && this.store.get('window.y')) {
      let x = this.store.get('window.x');
      let y = this.store.get('window.y');

      let displays = screen.getAllDisplays();
      let isResetWindiw = false;
      if (displays.length === 1) {
        let { bounds } = displays[0];
        if (
          x < bounds.x ||
          x > bounds.x + bounds.width - 50 ||
          y < bounds.y ||
          y > bounds.y + bounds.height - 50
        ) {
          isResetWindiw = true;
        }
      } else {
        isResetWindiw = true;
        for (let i = 0; i < displays.length; i++) {
          let { bounds } = displays[i];
          if (
            x > bounds.x &&
            x < bounds.x + bounds.width &&
            y > bounds.y &&
            y < bounds.y - bounds.height
          ) {
            // 检测到APP窗口当前处于一个可用的屏幕里，break
            isResetWindiw = false;
            break;
          }
        }
      }

      if (!isResetWindiw) {
        options.x = x;
        options.y = y;
      }
    }

    this.window = new BrowserWindow(options);

    // hide menu bar on Microsoft Windows and Linux
    this.window.setMenuBarVisibility(false);

    // 桌面歌词（M3-A）：窗口创建后注册一次，避免 macOS 重建窗口时重复注册
    if (!this.desktopLyricsIpcReady) {
      this.desktopLyricsIpcReady = true;
      const preloadPath = path.join(__dirname, 'preload.js');
      const isMainSender = event =>
        Boolean(this.window) && event.sender === this.window.webContents;

      setStatusReporter(status => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send(CHANNELS.status, status);
        }
      });

      ipcMain.handle(CHANNELS.toggle, async event => {
        if (!isMainSender(event)) return { ok: false, reason: 'forbidden' };
        if (getDesktopLyricsStatus().open) {
          closeDesktopLyrics();
          return { ok: true, status: getDesktopLyricsStatus() };
        }
        return openDesktopLyrics({ preload: preloadPath });
      });

      ipcMain.handle(CHANNELS.query, event => {
        if (!isMainSender(event)) return { ok: false, reason: 'forbidden' };
        return {
          ok: true,
          status: getDesktopLyricsStatus(),
          desktop: describeDesktop(),
        };
      });

      // 歌词正文：变更时才有（几十 KB，不做心跳）
      ipcMain.on(CHANNELS.payload, (event, payload) => {
        if (!isMainSender(event)) return;
        cacheSnapshot(CHANNELS.payload, payload);
        cacheRemoteSnapshot(CHANNELS.payload, payload);
      });

      // 播放态与样式：约 500ms 一次（几十字节）
      ipcMain.on(CHANNELS.state, (event, state) => {
        if (!isMainSender(event)) return;
        cacheSnapshot(CHANNELS.state, state);
        cacheRemoteSnapshot(CHANNELS.state, state);
      });

      // 远程控制窗口（M3-B）
      initRemoteIpc({ mainWindow: this.window, preload: preloadPath });
      setRemoteStatusReporter(status => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send(CHANNELS.remoteStatus, status);
        }
      });

      // 副窗口首次加载主动拉缓存（主窗口也允许，便于调试）
      ipcMain.handle('lyrics-snapshot:request', event => {
        const allowed =
          isMainSender(event) ||
          isDesktopLyricsSender(event.sender) ||
          isRemoteSender(event.sender);
        if (!allowed) return { ok: false, reason: 'forbidden' };
        return {
          ok: true,
          ...getCachedSnapshot(),
          ...getRemoteCachedSnapshot(),
        };
      });
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      // Load the url of the dev server if in development mode
      this.window.loadURL(
        showLibraryDefault
          ? `${process.env.VITE_DEV_SERVER_URL}/#/library`
          : process.env.VITE_DEV_SERVER_URL
      );
      if (!process.env.IS_TEST) this.window.webContents.openDevTools();
    } else {
      this.window.loadURL(
        showLibraryDefault
          ? 'http://localhost:27232/#/library'
          : 'http://localhost:27232'
      );
    }
  }

  /**
   * 设置内容安全策略（CSP）。
   *
   * Electron 会对没有 CSP 的页面给出安全警告；有了 CSP，即使出现注入类问题，
   * 也无法加载外部脚本或把数据外发。
   *
   * 只在**非开发**模式设置：开发模式的页面由 Vite 提供，HMR 需要 websocket 与
   * 更宽松的策略，强加 CSP 会打断开发体验。
   */
  applyContentSecurityPolicy() {
    if (process.env.VITE_DEV_SERVER_URL) return;

    const policy = [
      "default-src 'self'",
      // 图片与音频必须允许 http：网易云 CDN 返回的就是 http:// 链接
      // （封面、头像），且未登录时的音频外链会 302 到 http 的 CDN 地址。
      // 页面本身由本地 http 服务提供，此处放开 http 不额外扩大风险；
      // 真正关键的是 script-src 仍为 'self'。
      "img-src 'self' data: blob: https: http:",
      // 音频与 MV 来自 CDN、本地 blob（缓存音源）或 data:（bilibili 音源）。
      // 解锁音源（UnblockNeteaseMusic）还会命中酷狗/QQ 等不同主机，
      // 因此这里不做主机白名单。
      "media-src 'self' data: blob: https: http:",
      // Vue 的 scoped 样式与大量内联 style 绑定需要 style 内联
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self' data:",
      // 渲染进程与本机的 API(同源 /api)、CDN 转发(同源 /proxy) 通信；
      // 外部 XHR 只有两处：Last.fm 的 API（记录与正在播放，见 api/lastfm.js）
      // 与 AMLL 歌词库（逐字歌词的首选来源，见 src/lyrics/sources/amll.ts）。
      // 其余第三方地址（github / last.fm 授权页 / Vercel 徽章等）走 window.open
      // 或作为 img/media 加载，不受 connect-src 约束。
      "connect-src 'self' https://ws.audioscrobbler.com https://api.amll.dev",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [policy],
        },
      });
    });
    log('content security policy applied');
  }

  checkForUpdates() {
    if (isDevelopment) return;

    // 自动更新依赖打包时写入的发布源配置。在 M5 配置本项目自己的发布源之前，
    // 这里保持停用：既没有可用的更新 feed，上游的发布页也不属于本项目。
    // TODO(M5 发布前): 配置 electron-builder 的 publish 源后恢复此项。
    if (!RELEASES_URL) {
      log('skip checkForUpdates: RELEASES_URL not configured');
      return;
    }

    autoUpdater.autoDownload = false;
    if (!this._updateListenersBound) {
      this._updateListenersBound = true;
      autoUpdater.on('error', error => {
        log(`update check failed: ${error?.message || error}`);
      });
      autoUpdater.on('update-available', info => {
        dialog
          .showMessageBox({
            title: '发现新版本 v' + info.version,
            message: '发现新版本 v' + info.version,
            detail: '是否前往 GitHub 下载新版本安装包？',
            buttons: ['下载', '取消'],
            type: 'question',
            noLink: true,
          })
          .then(result => {
            if (result.response === 0) {
              shell.openExternal(RELEASES_URL);
            }
          });
      });
    }
    log('checkForUpdates');
    autoUpdater.checkForUpdates().catch(() => {
      // error 事件已统一记录；这里只吞掉 Promise rejection
    });
  }

  handleWindowEvents() {
    this.window.once('ready-to-show', () => {
      log('window ready-to-show event');
      this.window.show();
      this.store.set('window', this.window.getBounds());
    });

    this.window.on('close', e => {
      log('window close event');

      if (isLinux) {
        closeOnLinux(e, this.window, this.store);
      } else if (isMac) {
        if (this.willQuitApp) {
          this.window = null;
          app.quit();
        } else {
          e.preventDefault();
          this.window.hide();
        }
      } else {
        let closeOpt = this.store.get('settings.closeAppOption');
        if (this.willQuitApp && (closeOpt === 'exit' || closeOpt === 'ask')) {
          this.window = null;
          app.quit();
        } else {
          e.preventDefault();
          this.window.hide();
        }
      }
    });

    this.window.on('resized', () => {
      this.store.set('window', this.window.getBounds());
    });

    this.window.on('moved', () => {
      this.store.set('window', this.window.getBounds());
    });

    this.window.on('maximize', () => {
      this.window.webContents.send('isMaximized', true);
    });

    this.window.on('unmaximize', () => {
      this.window.webContents.send('isMaximized', false);
    });

    // Electron 22 起移除了 'new-window' 事件，改用 setWindowOpenHandler。
    // 语义与原实现一致：last.fm 的登录页开独立窗口，其余一律交给系统浏览器。
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      log('open url');
      const excludeHosts = ['www.last.fm'];
      const exclude = excludeHosts.find(host => url.includes(host));
      if (exclude) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 800,
            height: 600,
            titleBarStyle: 'default',
            title: PRODUCT_NAME,
            webPreferences: {
              // 该窗口加载的是远端页面（last.fm 登录），
              // 因此**不挂载**我们的 preload，也不给任何 Node 能力。
              contextIsolation: true,
              nodeIntegration: false,
              webSecurity: true,
              sandbox: true,
            },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  handleAppEvents() {
    app.on('ready', async () => {
      // This method will be called when Electron has finished
      // initialization and is ready to create browser windows.
      // Some APIs can only be used after this event occurs.
      log('app ready event');

      // for development
      if (isDevelopment) {
        this.initDevtools();
      }

      // create window
      this.createWindow();
      this.window.once('ready-to-show', () => {
        this.window.show();
      });
      this.handleWindowEvents();

      // create tray
      if (isCreateTray) {
        this.trayEventEmitter = new EventEmitter();
        this.ypmTrayImpl = createTray(
          this.window,
          this.trayEventEmitter,
          this.store
        );
      }

      // init ipcMain
      initIpcMain(this.window, this.store, this.trayEventEmitter);

      // set proxy
      const proxyRules = this.store.get('proxy');
      if (proxyRules) {
        this.window.webContents.session.setProxy({ proxyRules }, result => {
          log('finished setProxy', result);
        });
      }

      // check for updates
      this.checkForUpdates();

      // 内容安全策略
      this.applyContentSecurityPolicy();

      // create menu
      createMenu(this.window, this.store);

      // create dock menu for macOS
      const createdDockMenu = createDockMenu(this.window);
      if (createDockMenu && app.dock) app.dock.setMenu(createdDockMenu);

      // create touch bar
      const createdTouchBar = createTouchBar(this.window);
      if (createdTouchBar) this.window.setTouchBar(createdTouchBar);

      // register global shortcuts
      if (this.store.get('settings.enableGlobalShortcut') !== false) {
        registerGlobalShortcut(this.window, this.store);
      }

      // try to start osdlyrics process on start
      if (this.store.get('settings.enableOsdlyricsSupport')) {
        await createDbus(this.window);
        log('try to start osdlyrics process');
        const osdlyricsProcess = spawn('osdlyrics');

        osdlyricsProcess.on('error', err => {
          log(`failed to start osdlyrics: ${err.message}`);
        });

        osdlyricsProcess.on('exit', (code, signal) => {
          log(`osdlyrics process exited with code ${code}, signal ${signal}`);
        });
      }

      // create mpris
      if (isCreateMpris) {
        createMpris(this.window);
      }
    });

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      log('app activate event');
      if (this.window === null) {
        this.createWindow();
      } else {
        this.window.show();
      }
    });

    app.on('window-all-closed', () => {
      if (!isMac) {
        app.quit();
      }
    });

    app.on('before-quit', () => {
      this.willQuitApp = true;
      // 桌面歌词窗口挂在桌面层上：先摘除再退出，否则最后一帧会留在壁纸上
      disposeDesktopLyrics();
      disposeRemote();
    });

    app.on('quit', () => {
      this.expressApp.close();
    });

    app.on('will-quit', () => {
      // unregister all global shortcuts
      globalShortcut.unregisterAll();
    });

    if (!isMac) {
      app.on('second-instance', () => {
        if (this.window) {
          this.window.show();
          if (this.window.isMinimized()) {
            this.window.restore();
          }
          this.window.focus();
        }
      });
    }
  }
}

new Background();
