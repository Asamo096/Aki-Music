const { TouchBar, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { PRODUCT_NAME } = require('@/config/app');
const { STATIC_DIR } = require('@/electron/staticDir');

export function createTouchBar(window) {
  // Touch Bar 是 macOS 专有硬件，其他平台上该 API 无意义。
  // 上游未做平台判断，会让这段代码在 Windows/Linux 上照样执行。
  if (process.platform !== 'darwin') return null;

  const { TouchBarButton, TouchBarSpacer, TouchBarLabel } = TouchBar;
  const renderer = window.webContents;

  // Icon follow touchbar design guideline.
  // See: https://developer.apple.com/design/human-interface-guidelines/macos/touch-bar/touch-bar-icons-and-images/
  // Icon Resource: https://devimages-cdn.apple.com/design/resources/
  function getNativeIcon(name) {
    return nativeImage.createFromPath(
      path.join(STATIC_DIR, 'img/touchbar/', name)
    );
  }

  const playButton = new TouchBarButton({
    click: () => {
      renderer.send('play');
    },
    icon: getNativeIcon('play.png'),
  });

  const previousTrackButton = new TouchBarButton({
    click: () => {
      renderer.send('previous');
    },
    icon: getNativeIcon('backward.png'),
  });

  const nextTrackButton = new TouchBarButton({
    click: () => {
      renderer.send('next');
    },
    icon: getNativeIcon('forward.png'),
  });

  const likeButton = new TouchBarButton({
    click: () => {
      renderer.send('like');
    },
    icon: getNativeIcon('like.png'),
  });

  // 歌词显示标签 - 固定宽度以最大化显示空间
  const lyricLabel = new TouchBarLabel({
    label: `♪ ${PRODUCT_NAME}`,
    textColor: '#FFFFFF',
  });

  ipcMain.on('player', (e, { playing, likedCurrentTrack }) => {
    playButton.icon =
      playing === true ? getNativeIcon('pause.png') : getNativeIcon('play.png');
    likeButton.icon = likedCurrentTrack
      ? getNativeIcon('like_fill.png')
      : getNativeIcon('like.png');
  });

  // 监听歌词更新
  ipcMain.on('updateLyric', (e, { lyric }) => {
    if (lyric && lyric.trim()) {
      lyricLabel.label = `♪ ${lyric}`;
    } else {
      lyricLabel.label = `♪ ${PRODUCT_NAME}`;
    }
  });

  const touchBar = new TouchBar({
    items: [
      previousTrackButton,
      playButton,
      nextTrackButton,
      new TouchBarSpacer({ size: 'flexible' }),
      lyricLabel,
      new TouchBarSpacer({ size: 'flexible' }),
      likeButton,
    ],
  });
  return touchBar;
}
