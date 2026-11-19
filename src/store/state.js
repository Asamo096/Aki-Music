import initLocalStorage from './initLocalStorage';
import pkg from '../../package.json';
import updateApp from '@/utils/updateApp';
import { PRODUCT_NAME } from '@/config/app';

if (localStorage.getItem('appVersion') === null) {
  localStorage.setItem('settings', JSON.stringify(initLocalStorage.settings));
  localStorage.setItem('data', JSON.stringify(initLocalStorage.data));
  localStorage.setItem('appVersion', pkg.version);
}

updateApp();

export default {
  showLyrics: false,
  enableScrolling: true,
  title: PRODUCT_NAME,
  liked: {
    songs: [],
    songsWithDetails: [], // 只有前12首
    playlists: [],
    albums: [],
    artists: [],
    mvs: [],
    cloudDisk: [],
    playHistory: {
      weekData: [],
      allData: [],
    },
  },
  contextMenu: {
    clickObjectID: 0,
    showMenu: false,
  },
  toast: {
    show: false,
    text: '',
    timer: null,
  },
  modals: {
    addTrackToPlaylistModal: {
      show: false,
      selectedTrackID: 0,
    },
    newPlaylistModal: {
      show: false,
      afterCreateAddTrackID: 0,
    },
    listenTogetherModal: {
      show: false,
    },
  },
  /**
   * 双人「一起听」（M4）。真值由 utils/listenTogether.js 的 service 维护，
   * 通过 updateListenTogether 提交到这里供 UI 读写。
   */
  listenTogether: {
    inRoom: false,
    status: 'alone', // alone | together | togetherOwner
    roomId: '',
    inviterId: '',
    creatorId: '',
    roomMembers: [],
    roomPlaylist: [],
    roomPlaylistTracks: [],
    roomPlayCommand: null,
    followRoomPlayback: true,
    playlistVersion: 0,
    clientSeq: 0,
    shareLink: '',
    syncing: false,
    lastError: '',
  },
  dailyTracks: [],
  lastfm: JSON.parse(localStorage.getItem('lastfm')) || {},
  player: JSON.parse(localStorage.getItem('player')),
  settings: JSON.parse(localStorage.getItem('settings')),
  data: JSON.parse(localStorage.getItem('data')),
};
