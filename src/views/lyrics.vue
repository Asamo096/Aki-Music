<template>
  <transition name="slide-up">
    <div
      class="lyrics-page"
      :class="{ 'no-lyric': noLyric, 'fume-mode': fumeMode }"
      :data-theme="theme"
    >
      <div
        v-if="settings.lyricsBackground === 'fluid'"
        class="fluid-background-layer"
      >
        <LyricsBackgroundFluid
          :cover-url="bgImageUrl"
          @theme="onBackgroundTheme"
        />
      </div>
      <div
        v-if="
          (settings.lyricsBackground === 'blur') |
            (settings.lyricsBackground === 'dynamic')
        "
        class="lyrics-background"
        :class="{
          'dynamic-background': settings.lyricsBackground === 'dynamic',
        }"
      >
        <div
          class="top-right"
          :style="{ backgroundImage: `url(${bgImageUrl})` }"
        />
        <div
          class="bottom-left"
          :style="{ backgroundImage: `url(${bgImageUrl})` }"
        />
      </div>
      <div
        v-if="settings.lyricsBackground === true"
        class="gradient-background"
        :style="{ background }"
      ></div>

      <!-- 节拍脉冲：与背景风格无关，背景关闭时也能看到 -->
      <LyricsAudioPulse :color="coverAccent" />

      <!-- Fume 模式（V2）：Canvas 2D 竖向歌词流，替换 DOM 歌词区 -->
      <FumeVisualizer
        v-if="fumeMode"
        :lines="lines"
        :active-index="highlightLyricIndex"
        :has-word-timing="hasWordTiming"
        :secondary="secondaryLyric"
        :time-provider="fumeTimeProvider"
        :font-family="lyricFontSize.fontFamily"
        :font-size="Number(settings.lyricFontSize || 28)"
        :accent="coverAccent"
        :theme="theme"
        @seek="clickLyricLine"
      />

      <div class="left-side">
        <div>
          <div v-if="settings.showLyricsTime" class="date">
            {{ date }}
          </div>
          <div class="cover">
            <div class="cover-container">
              <img :src="imageUrl" loading="lazy" />
              <div
                class="shadow"
                :style="{ backgroundImage: `url(${imageUrl})` }"
              ></div>
            </div>
          </div>
          <div class="controls">
            <div class="top-part">
              <div class="track-info">
                <div class="title" :title="currentTrack.name">
                  <router-link
                    v-if="hasList()"
                    :to="`${getListPath()}`"
                    @click.native="toggleLyrics"
                    >{{ currentTrack.name }}
                  </router-link>
                  <span v-else>
                    {{ currentTrack.name }}
                  </span>
                </div>
                <div class="subtitle">
                  <router-link
                    v-if="artist.id !== 0"
                    :to="`/artist/${artist.id}`"
                    @click.native="toggleLyrics"
                    >{{ artist.name }}
                  </router-link>
                  <span v-else>
                    {{ artist.name }}
                  </span>
                  <span v-if="album.id !== 0">
                    -
                    <router-link
                      :to="`/album/${album.id}`"
                      :title="album.name"
                      @click.native="toggleLyrics"
                      >{{ album.name }}
                    </router-link>
                  </span>
                </div>
              </div>
              <div class="top-right">
                <div class="volume-control">
                  <button-icon :title="$t('player.mute')" @click.native="mute">
                    <svg-icon v-show="volume > 0.5" icon-class="volume" />
                    <svg-icon v-show="volume === 0" icon-class="volume-mute" />
                    <svg-icon
                      v-show="volume <= 0.5 && volume !== 0"
                      icon-class="volume-half"
                    />
                  </button-icon>
                  <div class="volume-bar">
                    <vue-slider
                      v-model="volume"
                      :min="0"
                      :max="1"
                      :interval="0.01"
                      :drag-on-click="true"
                      :duration="0"
                      tooltip="none"
                      :dot-size="12"
                    ></vue-slider>
                  </div>
                </div>
                <div class="buttons">
                  <button-icon
                    :title="$t('player.like')"
                    @click.native="likeATrack(player.currentTrack.id)"
                  >
                    <svg-icon
                      :icon-class="
                        player.isCurrentTrackLiked ? 'heart-solid' : 'heart'
                      "
                    />
                  </button-icon>
                  <button-icon
                    :title="$t('contextMenu.addToPlaylist')"
                    @click.native="addToPlaylist"
                  >
                    <svg-icon icon-class="plus" />
                  </button-icon>
                  <!-- <button-icon @click.native="openMenu" title="Menu"
                    ><svg-icon icon-class="more"
                  /></button-icon> -->
                </div>
              </div>
            </div>
            <div class="progress-bar">
              <span>{{ formatTrackTime(player.progress) || '0:00' }}</span>
              <div class="slider">
                <vue-slider
                  v-model="player.progress"
                  :min="0"
                  :max="player.currentTrackDuration"
                  :interval="1"
                  :drag-on-click="true"
                  :duration="0"
                  :dot-size="12"
                  :height="2"
                  :tooltip-formatter="formatTrackTime"
                  :lazy="true"
                  :silent="true"
                ></vue-slider>
              </div>
              <span>{{ formatTrackTime(player.currentTrackDuration) }}</span>
            </div>
            <div class="media-controls">
              <button-icon
                v-show="!player.isPersonalFM"
                :title="
                  player.repeatMode === 'one'
                    ? $t('player.repeatTrack')
                    : $t('player.repeat')
                "
                :class="{ active: player.repeatMode !== 'off' }"
                @click.native="switchRepeatMode"
              >
                <svg-icon
                  v-show="player.repeatMode !== 'one'"
                  icon-class="repeat"
                />
                <svg-icon
                  v-show="player.repeatMode === 'one'"
                  icon-class="repeat-1"
                />
              </button-icon>
              <div class="middle">
                <button-icon
                  v-show="!player.isPersonalFM"
                  :title="$t('player.previous')"
                  @click.native="playPrevTrack"
                >
                  <svg-icon icon-class="previous" />
                </button-icon>
                <button-icon
                  v-show="player.isPersonalFM"
                  title="不喜欢"
                  @click.native="moveToFMTrash"
                >
                  <svg-icon icon-class="thumbs-down" />
                </button-icon>
                <button-icon
                  id="play"
                  :title="$t(player.playing ? 'player.pause' : 'player.play')"
                  @click.native="playOrPause"
                >
                  <svg-icon :icon-class="player.playing ? 'pause' : 'play'" />
                </button-icon>
                <button-icon
                  :title="$t('player.next')"
                  @click.native="playNextTrack"
                >
                  <svg-icon icon-class="next" />
                </button-icon>
              </div>
              <button-icon
                v-show="!player.isPersonalFM"
                :title="$t('player.shuffle')"
                :class="{ active: player.shuffle }"
                @click.native="switchShuffle"
              >
                <svg-icon icon-class="shuffle" />
              </button-icon>
              <button-icon
                v-show="
                  isShowLyricTypeSwitch &&
                  $store.state.settings.showLyricsTranslation &&
                  lyricType === 'translation'
                "
                :title="$t('player.translationLyric')"
                @click.native="switchLyricType"
              >
                <span class="lyric-switch-icon">译</span>
              </button-icon>
              <button-icon
                v-show="
                  isShowLyricTypeSwitch &&
                  $store.state.settings.showLyricsTranslation &&
                  lyricType === 'romaPronunciation'
                "
                :title="$t('player.PronunciationLyric')"
                @click.native="switchLyricType"
              >
                <span class="lyric-switch-icon">音</span>
              </button-icon>
              <!-- 远程控制窗口（M3-B） -->
              <button-icon
                v-if="isElectron"
                :title="$t('remote.toggle')"
                :class="{ active: remoteOpen }"
                @click.native="toggleRemote"
              >
                <span class="lyric-switch-icon">控</span>
              </button-icon>
              <!-- 桌面歌词（M3-A）：把歌词挂进桌面壁纸层 -->
              <button-icon
                v-if="isElectron"
                :title="$t('settings.desktopLyrics.toggle')"
                :class="{ active: desktopLyricsOpen }"
                @click.native="toggleDesktopLyrics"
              >
                <span class="lyric-switch-icon">桌</span>
              </button-icon>
              <!-- 背景风格开关（M2-C）：与设置页共用同一份注册表 -->
              <div class="background-style-switch">
                <button-icon
                  :title="$t('settings.lyricsBackground.text')"
                  :class="{ active: backgroundMenuOpen }"
                  @click.native="backgroundMenuOpen = !backgroundMenuOpen"
                >
                  <span class="lyric-switch-icon">景</span>
                </button-icon>
                <div v-if="backgroundMenuOpen" class="background-style-menu">
                  <div class="menu-title">
                    {{ $t('settings.lyricsBackground.text') }}
                  </div>
                  <div
                    v-for="style in backgroundStyles"
                    :key="String(style.value)"
                    class="menu-item"
                    :class="{
                      active: style.value === settings.lyricsBackground,
                    }"
                    @click="chooseBackground(style.value)"
                  >
                    <span class="label">
                      {{ $t(`settings.lyricsBackground.${style.labelKey}`) }}
                      <span v-if="style.isNew" class="tag">{{
                        $t('settings.lyricsBackground.new')
                      }}</span>
                    </span>
                    <span class="cost" :class="`cost-${style.cost}`">{{
                      $t(`settings.lyricsBackground.cost.${style.cost}`)
                    }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="right-side">
        <transition name="slide-fade">
          <div
            v-show="!noLyric"
            ref="lyricsContainer"
            class="lyrics-container"
            :style="lyricFontSize"
          >
            <LyricLines
              :lines="lines"
              :active-index="highlightLyricIndex"
              :has-word-timing="hasWordTiming"
              :secondary="secondaryLyric"
              :auto-scroll="showLyrics"
              :audio-reactive="settings.visualAudioReactive && !fumeMode"
              @seek="clickLyricLine"
              @menu="openLyricMenu"
            />
            <ContextMenu v-if="!noLyric" ref="lyricMenu">
              <div class="item" @click="copyLyric(false)">{{
                $t('contextMenu.copyLyric')
              }}</div>
              <div
                v-if="
                  rightClickLyric &&
                  hasSecondaryForMenu &&
                  $store.state.settings.showLyricsTranslation
                "
                class="item"
                @click="copyLyric(true)"
                >{{ $t('contextMenu.copyLyricWithTranslation') }}</div
              >
            </ContextMenu>
          </div>
        </transition>
      </div>
      <div class="close-button" @click="toggleLyrics">
        <button>
          <svg-icon icon-class="arrow-down" />
        </button>
      </div>
      <div class="close-button" style="left: 24px" @click="fullscreen">
        <button>
          <svg-icon v-if="isFullscreen" icon-class="fullscreen-exit" />
          <svg-icon v-else icon-class="fullscreen" />
        </button>
      </div>
    </div>
  </transition>
</template>

<script>
// The lyrics page of Apple Music is so gorgeous, so I copy the design.
// Some of the codes are from https://github.com/sl1673495/vue-netease-music

import { mapState, mapMutations, mapActions } from 'vuex';
import AkiSlider from '@/components/AkiSlider.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import LyricLines from '@/components/LyricLines.vue';
import { formatTrackTime } from '@/utils/common';
import { getCloudLyric } from '@/api/track';
import { copyLyric } from '@/utils/lyrics';
import {
  loadLyrics,
  parseLyricPayload,
  filterNeteaseLyricNoise,
  getLineText,
  getLineSecondaryText,
} from '@/lyrics';
import { resolveLyricsFontFamily } from '@/settings/fontStacks';
import { restoreUploadedFont } from '@/settings/customFont';
import LyricsBackgroundFluid from '@/components/LyricsBackgroundFluid.vue';
import LyricsAudioPulse from '@/components/LyricsAudioPulse.vue';
import FumeVisualizer from '@/components/FumeVisualizer.vue';
import visualRuntime from '@/visual/runtime';
import {
  LYRIC_BACKGROUND_STYLES,
  isDarkBackgroundStyle,
} from '@/settings/lyricBackground';
import { publishLyricsPayload } from '@/desktopLyrics/broadcast';
import {
  CHANNELS,
  normalizeDesktopLyricsSettings,
} from '@/shared/lyricsSnapshot';
import { createLyricPlayhead } from '@/lyrics/timing/playhead';
import ButtonIcon from '@/components/ButtonIcon.vue';
import * as Vibrant from 'node-vibrant/dist/vibrant.worker.min.js';
import Color from 'color';
import { isAccountLoggedIn } from '@/utils/auth';
import { hasListSource, getListSourcePath } from '@/utils/playList';
import locale from '@/locale';
import { ipcRenderer as electronIpcRenderer } from '@/utils/electronBridge';

const ipcRenderer =
  process.env.IS_ELECTRON === true ? electronIpcRenderer : null;

export default {
  name: 'Lyrics',
  components: {
    'vue-slider': AkiSlider,
    ButtonIcon,
    ContextMenu,
    LyricLines,
    LyricsBackgroundFluid,
    LyricsAudioPulse,
    FumeVisualizer,
  },
  data() {
    return {
      /** 引擎产出的歌词（null = 无歌词） */
      lyricData: null,
      /** 是否纯音乐（点击行不跳转，与旧行为一致） */
      instrumental: false,
      lyricType: 'translation', // or 'romaPronunciation'
      highlightLyricIndex: -1,
      minimize: true,
      background: '',
      /** 歌词页内的背景风格开关 */
      backgroundMenuOpen: false,
      /** 多色背景取到的主题色：让逐字扫过也用上封面的颜色 */
      coverAccent: '',
      /** 桌面歌词（M3-A）开关状态 */
      desktopLyricsOpen: false,
      /** 远程控制窗口（M3-B）开关状态 */
      remoteOpen: false,
      /** 歌词请求序号：换歌后旧请求晚到时用它丢弃结果（见 getLyric） */
      lyricRequestId: 0,
      /** 当前 lyricData 属于哪首歌（与 currentTrack.id 不一致即为 bug） */
      lyricTrackId: null,
      /** 模板里用：是否 Electron 客户端（App.vue 的 data 不会传给子组件） */
      isElectron: process.env.IS_ELECTRON === true,
      date: this.formatTime(new Date()),
      isFullscreen: !!document.fullscreenElement,
      rightClickLyric: null,
    };
  },
  computed: {
    ...mapState(['player', 'settings', 'showLyrics']),
    /** Fume 模式：没有歌词时回退到 DOM（保留“无歌词”提示） */
    fumeMode() {
      return this.settings.visualMode === 'fume' && !this.noLyric;
    },
    currentTrack() {
      return this.player.currentTrack;
    },
    volume: {
      get() {
        return this.player.volume;
      },
      set(value) {
        this.player.volume = value;
      },
    },
    imageUrl() {
      return this.player.currentTrack?.al?.picUrl + '?param=1024y1024';
    },
    bgImageUrl() {
      return this.player.currentTrack?.al?.picUrl + '?param=512y512';
    },
    /** 引擎产出的歌词行（统一数据契约，见 src/lyrics/types.ts） */
    lines() {
      return this.lyricData?.lines ?? [];
    },
    /** 是否有逐字时间轴（行级歌词不做逐字扫过） */
    hasWordTiming() {
      return this.lyricData?.hasWordTiming === true;
    },
    hasTranslation() {
      return this.lines.some(line => Boolean(line.translation));
    },
    hasRoman() {
      return this.lines.some(line => Boolean(line.roman));
    },
    isShowLyricTypeSwitch() {
      return this.hasTranslation && this.hasRoman;
    },
    /** 副行显示什么：跟设置与切换按钮走；关掉翻译显示时副行整体不显示 */
    secondaryLyric() {
      if (!this.settings.showLyricsTranslation) return 'none';
      return this.lyricType === 'translation'
        ? 'translation'
        : 'romaPronunciation';
    },
    /** 右键的那一行是否有副行文本（决定"复制歌词与翻译"菜单项是否出现） */
    hasSecondaryForMenu() {
      const line = this.rightClickLyric
        ? this.lines[this.rightClickLyric.index]
        : null;
      if (!line) return false;
      return Boolean(
        getLineSecondaryText(line, 'translation') ||
          getLineSecondaryText(line, 'romaPronunciation')
      );
    },
    lyricFontSize() {
      return {
        fontSize: `${this.$store.state.settings.lyricFontSize || 28}px`,
        // 字体（M2-B）：设置 → CSS 栈的统一解析入口，见 settings/fontStacks.ts
        fontFamily: resolveLyricsFontFamily(this.settings),
        // 多色背景给了主题主色时，逐字扫过用它（其它风格下留空 → 回落到 currentColor）
        '--lyric-accent': this.coverAccent || null,
      };
    },
    noLyric() {
      return this.lines.length === 0;
    },
    artist() {
      return this.currentTrack?.ar
        ? this.currentTrack.ar[0]
        : { id: 0, name: 'unknown' };
    },
    album() {
      return this.currentTrack?.al || { id: 0, name: 'unknown' };
    },
    theme() {
      // 深色背景（取色渐变 / 多色模糊）必须用深色主题，否则浅色文字读不出来
      return isDarkBackgroundStyle(this.settings.lyricsBackground)
        ? 'dark'
        : 'auto';
    },
    backgroundStyles() {
      return LYRIC_BACKGROUND_STYLES;
    },
  },
  watch: {
    currentTrack() {
      // 先清空：新歌词到达前（AMLL 最坏 5s）不能继续显示上一首的词
      this.lyricData = null;
      this.lyricTrackId = null;
      this.highlightLyricIndex = -1;
      this.instrumental = false;
      this.publishLyricsSnapshot();
      this.lyricPlayhead?.poll();
      this.getLyric();
      this.getCoverColor();
    },
    showLyrics(show) {
      visualRuntime.setPageVisible(show);
      if (show) {
        // 播放头始终在跑（Touch Bar 需要），这里只需恢复滚动能力
        this.$store.commit('enableScrolling', false);
      } else {
        this.$store.commit('enableScrolling', true);
        // Fullscreen is requested on documentElement, so it makes the whole
        // window fullscreen. Since the only way to leave fullscreen from the
        // UI lives on this page, closing it would leave the window stuck in
        // fullscreen with no way out (minimize/restore stays fullscreen).
        this.exitFullscreen();
      }
    },
  },
  mounted() {
    // 组件常驻（v-show），运行时要按"歌词页是否显示"启停
    visualRuntime.setPageVisible(this.showLyrics);
  },
  created() {
    this.getLyric();
    this.getCoverColor();
    this.initDate();
    // 恢复用户上传的歌词字体（幂等；通常是热启动时库里已有记录）
    restoreUploadedFont();
    // 桌面歌词状态（副窗口可能因挂载失败被自动关闭）
    if (ipcRenderer) {
      // preload 的 on() 回调签名是 (占位 event, ...args)
      ipcRenderer.on(CHANNELS.status, (_event, status) => {
        this.desktopLyricsOpen = Boolean(status?.open);
      });
      ipcRenderer
        .invoke(CHANNELS.query)
        .then(result => {
          this.desktopLyricsOpen = Boolean(result?.status?.open);
        })
        .catch(() => {});
      ipcRenderer.on(CHANNELS.remoteStatus, (_event, status) => {
        this.remoteOpen = Boolean(status?.open);
      });
      // 远程窗口的齿轮面板改的是桌面歌词外观：真值落在这里（主窗口）的 settings，
      // 落库后由下方 watch 触发快照重发，两个副窗口随之更新
      ipcRenderer.on(CHANNELS.desktopSettings, (_event, patch) => {
        this.$store.commit('updateSettings', {
          key: 'desktopLyrics',
          value: normalizeDesktopLyricsSettings(patch),
        });
      });
    }
    // 样式变化（字体/字号/翻译/主题色）后重发一次快照，副窗口跟随
    this.$watch(
      () => [
        this.settings.lyricFontPreset,
        this.settings.lyricsFontFamily,
        this.settings.lyricFontSize,
        this.settings.showLyricsTranslation,
        this.lyricType,
        this.coverAccent,
        this.settings.desktopLyrics,
      ],
      () => this.publishLyricsSnapshot()
    );
    // 播放头：可见时 rAF、不可见时低频兜底，保证 Touch Bar 在后台也能更新
    this.lyricPlayhead = createLyricPlayhead({
      getLines: () => this.lines,
      getTime: () => this.player.seek(null, false) ?? 0,
      onIndexChange: this.onLyricLineChange,
    });
    this.lyricPlayhead.start();
    document.addEventListener('keydown', e => {
      if (e.key === 'F11') {
        e.preventDefault();
        this.fullscreen();
      }
    });
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
    });
  },
  beforeDestroy: function () {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.exitFullscreen();
  },
  destroyed() {
    visualRuntime.setPageVisible(false);
    if (this.lyricPlayhead) {
      this.lyricPlayhead.stop();
      this.lyricPlayhead = null;
    }
  },
  methods: {
    ...mapMutations(['toggleLyrics', 'updateModal']),
    ...mapActions(['likeATrack']),
    initDate() {
      var _this = this;
      clearInterval(this.timer);
      this.timer = setInterval(function () {
        _this.date = _this.formatTime(new Date());
      }, 1000);
    },
    formatTime(value) {
      let hour = value.getHours().toString();
      let minute = value.getMinutes().toString();
      let second = value.getSeconds().toString();
      return (
        hour.padStart(2, '0') +
        ':' +
        minute.padStart(2, '0') +
        ':' +
        second.padStart(2, '0')
      );
    },
    fullscreen() {
      if (document.fullscreenElement) {
        this.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },
    exitFullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    },
    addToPlaylist() {
      if (!isAccountLoggedIn()) {
        this.showToast(locale.t('toast.needToLogin'));
        return;
      }
      this.$store.dispatch('fetchLikedPlaylist');
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'show',
        value: true,
      });
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'selectedTrackID',
        value: this.currentTrack?.id,
      });
    },
    playPrevTrack() {
      this.player.playPrevTrack();
    },
    playOrPause() {
      this.player.playOrPause();
    },
    playNextTrack() {
      if (this.player.isPersonalFM) {
        this.player.playNextFMTrack();
      } else {
        this.player.playNextTrack();
      }
    },
    /**
     * 取歌词：走三级引擎（AMLL TTML → 网易云逐字 → 网易云行级）。
     * 云盘未关联歌曲走老接口取内置歌词，再归一成同一份 LyricData。
     */
    async getLyric() {
      const track = this.currentTrack;
      if (!track?.id) return;

      // 换歌很快时，多首歌的取词请求会并发；只有**最后一次**请求的结果可以上屏，
      // 否则上一首的歌词会晚到并覆盖当前曲目（"播放的歌曲和播放页不符"）。
      const requestId = ++this.lyricRequestId;
      const isStale = () =>
        requestId !== this.lyricRequestId || this.currentTrack?.id !== track.id;

      const isCloudTrack =
        track.pc !== null &&
        track.cd === null &&
        this.$store.state.data.user?.userId;

      let data = null;
      try {
        if (isCloudTrack) {
          //云盘未设置关联的歌曲获取其内置歌词
          const cloud = await getCloudLyric(
            track.id,
            this.$store.state.data.user?.userId
          );
          data =
            cloud?.lrc?.length > 0
              ? parseLyricPayload(cloud.lrc, { format: 'lrc' })
              : null;
        } else {
          data = await loadLyrics(track.id, {
            preferredLangs: this.$i18n?.locale ? [this.$i18n.locale] : [],
          });
        }
      } catch (error) {
        console.warn('[lyrics] 取词失败', error);
        data = null;
      }
      if (isStale()) return; // 过期结果：直接丢弃，不碰当前状态

      const filtered = filterNeteaseLyricNoise(
        data?.lines ?? [],
        track?.ar?.[0]?.name
      );
      this.instrumental = filtered.instrumental;
      this.lyricData = filtered.lines.length
        ? { ...data, lines: filtered.lines }
        : null;
      this.lyricTrackId = track.id;
      this.highlightLyricIndex = -1;
      // 新歌词到位：立刻按当前位置判定一次，避免等到下一拍才高亮
      this.lyricPlayhead?.poll();

      if (this.hasTranslation && !this.hasRoman) {
        this.lyricType = 'translation';
      } else if (!this.hasTranslation && this.hasRoman) {
        this.lyricType = 'romaPronunciation';
      }

      // 推给副窗口（桌面歌词 / 远程控制）
      this.publishLyricsSnapshot();
    },
    /** 把当前歌词与样式推给主进程，由它缓存并转发给副窗口 */
    publishLyricsSnapshot() {
      const track = this.currentTrack;
      publishLyricsPayload(track?.id ?? null, this.lyricData, this.settings, {
        secondary: this.secondaryLyric,
        accent: this.coverAccent,
        track: track
          ? {
              name: track.name,
              artist: (track.ar ?? []).map(item => item.name).join(' / '),
              cover: track.al?.picUrl ? `${track.al.picUrl}?param=96y96` : '',
            }
          : null,
      });
    },
    /** 远程控制窗口开关 */
    async toggleRemote() {
      if (!ipcRenderer) return;
      try {
        const result = await ipcRenderer.invoke('remote:toggle');
        this.remoteOpen = Boolean(result?.status?.open);
      } catch (error) {
        console.warn('[remote] 开关失败', error);
      }
    },
    /** 桌面歌词开关（壁纸层） */
    async toggleDesktopLyrics() {
      if (!ipcRenderer) return;
      try {
        const result = await ipcRenderer.invoke(CHANNELS.toggle);
        this.desktopLyricsOpen = Boolean(result?.status?.open);
        if (!result?.ok) {
          const key = result?.reason || 'unknown';
          this.showToast(
            this.$t(`settings.desktopLyrics.errors.${key}`, {
              defaultValue: this.$t('settings.desktopLyrics.errors.unknown'),
            })
          );
        }
      } catch (error) {
        console.warn('[desktop-lyrics] 开关失败', error);
      }
    },
    switchLyricType() {
      this.lyricType =
        this.lyricType === 'translation' ? 'romaPronunciation' : 'translation';
    },
    /** 歌词页内的背景风格切换（与设置页共用 settings.lyricsBackground） */
    chooseBackground(style) {
      this.$store.commit('updateSettings', {
        key: 'lyricsBackground',
        value: style,
      });
      this.backgroundMenuOpen = false;
      // 离开多色风格时清掉主题主色，避免它继续染着逐字颜色
      if (style !== 'fluid') this.coverAccent = '';
      // 渐变背景的颜色是按需计算的，切回来时补算一次
      this.getCoverColor();
    },
    /** 多色背景组件取到主题后回传主色 */
    onBackgroundTheme(theme) {
      this.coverAccent = theme?.primaryColor ?? '';
    },
    formatTrackTime(value) {
      return formatTrackTime(value);
    },
    /** Fume 渲染器的时间源：与歌词页/桌面歌词共用同一播放时钟 */
    fumeTimeProvider() {
      return this.$store.state.player?.seek?.(null, false) ?? 0;
    },
    clickLyricLine(value, startPlay = false) {
      // TODO: 双击选择还会选中文字，考虑搞个右键菜单复制歌词
      if (window.getSelection().toString().length === 0 && !this.instrumental) {
        this.player.seek(value);
      }
      if (startPlay === true) {
        this.player.play();
      }
    },
    /** 右键某一行：index 是行下标，which 是点中的那一段（原文/副行） */
    openLyricMenu(e, index, which) {
      this.rightClickLyric = { index, which };
      this.$refs.lyricMenu.openMenu(e);
      e.preventDefault();
    },
    copyLyric(withTranslation) {
      if (!this.rightClickLyric) return;
      const { index, which } = this.rightClickLyric;
      const line = this.lines[index];
      if (!line) return;
      const primary = getLineText(line);
      const secondary = getLineSecondaryText(line, this.lyricType);
      if (!withTranslation) {
        copyLyric(which === 'secondary' ? secondary : primary);
      } else {
        copyLyric([primary, secondary].filter(Boolean).join(' '));
      }
    },
    /** 播放头的行变化回调：更新高亮 + 给 Touch Bar 上报当前行 */
    onLyricLineChange(index) {
      this.highlightLyricIndex = index;
      if (ipcRenderer && index >= 0) {
        const currentLyricLine = this.lines[index];
        if (currentLyricLine) {
          // 只发送原文，避免 Touch Bar 显示过长
          ipcRenderer.send('updateLyric', {
            lyric: getLineText(currentLyricLine),
          });
        }
      }
    },
    moveToFMTrash() {
      this.player.moveToFMTrash();
    },
    switchRepeatMode() {
      this.player.switchRepeatMode();
    },
    switchShuffle() {
      this.player.switchShuffle();
    },
    getCoverColor() {
      if (this.settings.lyricsBackground !== true) return;
      const cover = this.currentTrack.al?.picUrl + '?param=256y256';
      Vibrant.from(cover, { colorCount: 1 })
        .getPalette()
        .then(palette => {
          const originColor = Color.rgb(palette.DarkMuted._rgb);
          const color = originColor.darken(0.1).rgb().string();
          const color2 = originColor.lighten(0.28).rotate(-30).rgb().string();
          this.background = `linear-gradient(to top left, ${color}, ${color2})`;
        });
    },
    hasList() {
      return hasListSource();
    },
    getListPath() {
      return getListSourcePath();
    },
    mute() {
      this.player.mute();
    },
  },
};
</script>

<style lang="scss" scoped>
.lyrics-page {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  z-index: 200;
  background: var(--color-body-bg);
  display: flex;
  clip: rect(auto, auto, auto, auto);

  /* Fume 模式：Canvas 接管整页歌词，隐藏 DOM 歌词与封面（保留关闭按钮/播放控件） */
  &.fume-mode {
    .left-side,
    .right-side {
      display: none;
    }
  }
}

.lyrics-background {
  --contrast-lyrics-background: 75%;
  --brightness-lyrics-background: 150%;
}

[data-theme='dark'] .lyrics-background {
  --contrast-lyrics-background: 125%;
  --brightness-lyrics-background: 50%;
}

.lyrics-background {
  filter: blur(50px) contrast(var(--contrast-lyrics-background))
    brightness(var(--brightness-lyrics-background));
  position: absolute;
  height: 100vh;
  width: 100vw;

  .top-right,
  .bottom-left {
    z-index: 0;
    width: 140vw;
    height: 140vw;
    opacity: 0.6;
    position: absolute;
    background-size: cover;
  }

  .top-right {
    right: 0;
    top: 0;
    mix-blend-mode: luminosity;
  }

  .bottom-left {
    left: 0;
    bottom: 0;
    animation-direction: reverse;
    animation-delay: 10s;
  }
}

.dynamic-background > div {
  animation: rotate 150s linear infinite;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.gradient-background {
  position: absolute;
  height: 100vh;
  width: 100vw;
}

.left-side {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  margin-right: 32px;
  margin-top: 24px;
  align-items: center;
  transition: all 0.5s;

  z-index: 1;

  .date {
    max-width: 54vh;
    margin: 24px 0;
    color: var(--color-text);
    text-align: center;
    font-size: 4rem;
    font-weight: 600;
    opacity: 0.88;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
  }

  .controls {
    max-width: 54vh;
    margin-top: 24px;
    color: var(--color-text);

    .title {
      margin-top: 8px;
      font-size: 1.4rem;
      font-weight: 600;
      opacity: 0.88;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
    }

    .subtitle {
      margin-top: 4px;
      font-size: 1rem;
      opacity: 0.58;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
    }

    .top-part {
      display: flex;
      justify-content: space-between;

      .top-right {
        display: flex;
        justify-content: space-between;

        .volume-control {
          margin: 0 10px;
          display: flex;
          align-items: center;

          .volume-bar {
            width: 84px;
          }
        }

        .buttons {
          display: flex;
          align-items: center;

          button {
            margin: 0 0 0 4px;
          }

          .svg-icon {
            height: 18px;
            width: 18px;
          }
        }
      }
    }

    .progress-bar {
      margin-top: 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .slider {
        width: 100%;
        flex-grow: grow;
        padding: 0 10px;
      }

      span {
        font-size: 15px;
        opacity: 0.58;
        min-width: 28px;
      }
    }

    .media-controls {
      display: flex;
      justify-content: center;
      margin-top: 18px;
      align-items: center;

      button {
        margin: 0;
      }

      .svg-icon {
        opacity: 0.38;
        height: 14px;
        width: 14px;
      }

      .active .svg-icon {
        opacity: 0.88;
      }

      .middle {
        padding: 0 16px;
        display: flex;
        align-items: center;

        button {
          margin: 0 8px;
        }

        button#play .svg-icon {
          height: 28px;
          width: 28px;
          padding: 2px;
        }

        .svg-icon {
          opacity: 0.88;
          height: 22px;
          width: 22px;
        }
      }

      .lyric-switch-icon {
        color: var(--color-text);
        font-size: 14px;
        line-height: 14px;
        opacity: 0.88;
      }

      /* 背景风格开关（M2-C）：按钮 + 下拉，与设置页同一份注册表 */
      .background-style-switch {
        position: relative;

        .background-style-menu {
          position: absolute;
          bottom: 42px;
          left: 50%;
          transform: translateX(-50%);
          min-width: 190px;
          padding: 8px;
          border-radius: 12px;
          background: var(--color-secondary-bg, #2a2a2e);
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.36);
          z-index: 400;

          .menu-title {
            padding: 4px 8px 8px;
            font-size: 12px;
            opacity: 0.5;
            white-space: nowrap;
          }

          .menu-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 7px 8px;
            border-radius: 8px;
            font-size: 13px;
            cursor: pointer;
            white-space: nowrap;

            &:hover {
              background: var(--color-shape-color);
            }

            &.active .label {
              color: var(--color-primary);
            }

            .tag {
              margin-left: 6px;
              padding: 1px 5px;
              border-radius: 5px;
              font-size: 10px;
              background: var(--color-primary);
              color: #fff;
            }

            .cost {
              font-size: 11px;
              opacity: 0.45;
            }
          }
        }
      }
    }
  }
}

.cover {
  position: relative;

  .cover-container {
    position: relative;
  }

  img {
    border-radius: 0.75em;
    width: 54vh;
    height: 54vh;
    user-select: none;
    object-fit: cover;
  }

  .shadow {
    position: absolute;
    top: 12px;
    height: 54vh;
    width: 54vh;
    filter: blur(16px) opacity(0.6);
    transform: scale(0.92, 0.96);
    z-index: -1;
    background-size: cover;
    border-radius: 0.75em;
  }
}

.right-side {
  flex: 1;
  font-weight: 600;
  color: var(--color-text);
  margin-right: 24px;
  z-index: 0;

  .lyrics-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-left: 78px;
    max-width: 460px;
    overflow-y: auto;
    transition: 0.5s;
    scrollbar-width: none; // firefox

    // 行本身（.line / .content / .translation / 上下留白）由 LyricLines 组件渲染，
    // 样式在组件内（scoped），这里只保留滚动容器。
  }

  ::-webkit-scrollbar {
    display: none;
  }
}

.close-button {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 300;
  border-radius: 0.75rem;
  height: 44px;
  width: 44px;
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0.28;
  transition: 0.2s;
  -webkit-app-region: no-drag;

  .svg-icon {
    color: var(--color-text);
    padding-top: 5px;
    height: 22px;
    width: 22px;
  }

  &:hover {
    background: var(--color-secondary-bg-for-transparent);
    opacity: 0.88;
  }
}

.lyrics-page.no-lyric {
  .left-side {
    transition: all 0.5s;
    transform: translateX(27vh);
    margin-right: 0;
  }
}

@media (max-aspect-ratio: 10/9) {
  .left-side {
    display: none;
  }

  .right-side .lyrics-container {
    max-width: 100%;
  }
}

@media screen and (min-width: 1200px) {
  .right-side .lyrics-container {
    max-width: 600px;
  }
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s;
}

.slide-up-enter,
.slide-up-leave-to

/* .fade-leave-active below version 2.1.8 */ {
  transform: translateY(100%);
}

.slide-fade-enter-active {
  transition: all 0.5s ease;
}

.slide-fade-leave-active {
  transition: all 0.5s cubic-bezier(0.2, 0.2, 0, 1);
}

.slide-fade-enter,
.slide-fade-leave-to {
  transform: translateX(27vh);
  opacity: 0;
}
</style>
