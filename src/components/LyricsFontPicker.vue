<template>
  <div class="lyrics-font-picker">
    <div class="item">
      <div class="left">
        <div class="title">{{ $t('settings.lyricsFont.text') }}</div>
        <div class="description">{{ currentLabel }}</div>
      </div>
      <div class="right">
        <button @click="open = !open">
          {{
            open
              ? $t('settings.lyricsFont.close')
              : $t('settings.lyricsFont.choose')
          }}
        </button>
      </div>
    </div>

    <div v-if="open" class="panel">
      <!-- 预设 -->
      <div class="section">
        <div class="section-title">{{ $t('settings.lyricsFont.preset') }}</div>
        <div class="presets">
          <button
            v-for="preset in presets"
            :key="preset.value"
            :class="{ active: settings.lyricsFontPreset === preset.value }"
            :style="{ fontFamily: preset.preview }"
            @click="choosePreset(preset.value)"
          >
            {{ $t(`settings.lyricsFont.presetLabels.${preset.value}`) }}
          </button>
        </div>
      </div>

      <!-- 预览 -->
      <div class="section">
        <div class="section-title">{{ $t('settings.lyricsFont.preview') }}</div>
        <div class="preview" :style="{ fontFamily: currentFamily }">
          <div class="preview-line">{{ previewText }}</div>
          <div class="preview-line secondary">
            The quick brown fox jumps over the lazy dog
          </div>
        </div>
      </div>

      <!-- 本机字体 -->
      <div class="section">
        <div class="section-title">{{ $t('settings.lyricsFont.system') }}</div>
        <div class="system-row">
          <input
            v-model="search"
            class="search"
            type="text"
            :placeholder="$t('settings.lyricsFont.search')"
            @focus="loadSystemFonts()"
          />
          <button
            class="ghost"
            :disabled="loading"
            @click="loadSystemFonts(true)"
          >
            {{
              loading
                ? $t('settings.lyricsFont.loading')
                : $t('settings.lyricsFont.loadSystem')
            }}
          </button>
        </div>
        <div v-if="fontError" class="hint error">{{ fontError }}</div>
        <div v-else-if="filteredFonts.length" class="font-list">
          <button
            v-for="font in filteredFonts"
            :key="font.family"
            class="font-item"
            :class="{
              active: settings.lyricsFontFamily === font.family,
              unavailable: font.unavailable,
            }"
            @click="chooseSystemFont(font)"
          >
            <span class="name" :style="{ fontFamily: font.cssFamily }">{{
              font.family
            }}</span>
            <span v-if="font.unavailable" class="tag">{{
              $t('settings.lyricsFont.unavailable')
            }}</span>
          </button>
        </div>
        <div v-else-if="loadedOnce" class="hint">
          {{ $t('settings.lyricsFont.empty') }}
        </div>
      </div>

      <!-- 上传 -->
      <div class="section">
        <div class="section-title">{{ $t('settings.lyricsFont.upload') }}</div>
        <div class="upload-row">
          <label class="upload-button">
            <input
              ref="fileInput"
              type="file"
              accept=".woff2,.woff,.ttf,.otf"
              @change="handleFile"
            />
            {{ $t('settings.lyricsFont.uploadButton') }}
          </label>
          <span v-if="uploadedLabel" class="uploaded">
            {{ $t('settings.lyricsFont.uploaded', { name: uploadedLabel }) }}
          </span>
          <button v-if="uploadedLabel" class="ghost" @click="removeUploaded">
            {{ $t('settings.lyricsFont.remove') }}
          </button>
        </div>
        <div class="hint">{{ $t('settings.lyricsFont.uploadHint') }}</div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * 歌词字体选择器（M2-B）。
 *
 * 三条来源：
 *   1. 预设 —— 应用自带 Barlow（默认）/ 系统黑体 · 宋体 · 等宽（见 settings/fontStacks.ts）
 *   2. 本机字体 —— Local Font Access API（queryLocalFonts，Chromium 专有，需授权）
 *   3. 上传字体 —— 校验后注册为 FontFace 并持久化到 IndexedDB（见 settings/customFont.ts）
 *
 * 兼容性设计：queryLocalFonts 不可用（权限被拒 / 非 Chromium）时**不报错阻断**，
 * 提示改用上传；上传与预设在任何环境都可用。
 */
import { mapState } from 'vuex';
import {
  buildFontFamilyCss,
  resolveLyricsFontFamily,
} from '@/settings/fontStacks';
import { isFontFamilyAvailableCached } from '@/settings/fontAvailability';
import {
  clearUploadedFont,
  restoreUploadedFont,
  uploadFont,
} from '@/settings/customFont';

const PREVIEW_TEXT = '夜空中最亮的星 能否听清';

export default {
  name: 'LyricsFontPicker',
  data() {
    return {
      open: false,
      search: '',
      fonts: [],
      loading: false,
      loadedOnce: false,
      fontError: '',
      uploadedLabel: '',
    };
  },
  computed: {
    ...mapState(['settings']),
    presets() {
      return [
        {
          value: 'app',
          preview: resolveLyricsFontFamily({ lyricsFontPreset: 'app' }),
        },
        {
          value: 'sans',
          preview: resolveLyricsFontFamily({ lyricsFontPreset: 'sans' }),
        },
        {
          value: 'serif',
          preview: resolveLyricsFontFamily({ lyricsFontPreset: 'serif' }),
        },
        {
          value: 'mono',
          preview: resolveLyricsFontFamily({ lyricsFontPreset: 'mono' }),
        },
      ];
    },
    currentLabel() {
      const preset = this.settings.lyricsFontPreset ?? 'app';
      if (preset === 'custom') {
        const family = (this.settings.lyricsFontFamily || '').trim();
        return family || this.$t('settings.lyricsFont.notChosen');
      }
      return this.$t(`settings.lyricsFont.presetLabels.${preset}`);
    },
    currentFamily() {
      return resolveLyricsFontFamily(this.settings);
    },
    previewText() {
      return PREVIEW_TEXT;
    },
    filteredFonts() {
      const query = this.search.trim().toLocaleLowerCase();
      if (!query) return this.fonts;
      return this.fonts.filter(font =>
        font.family.toLocaleLowerCase().includes(query)
      );
    },
  },
  mounted() {
    this.refreshUploadedLabel();
  },
  methods: {
    choosePreset(preset) {
      this.$store.commit('updateSettings', {
        key: 'lyricsFontPreset',
        value: preset,
      });
    },
    chooseSystemFont(font) {
      this.$store.commit('updateSettings', {
        key: 'lyricsFontPreset',
        value: 'custom',
      });
      this.$store.commit('updateSettings', {
        key: 'lyricsFontFamily',
        value: font.family,
      });
    },
    /** 读取本机字体（首次会弹权限框）。失败按"不可用"处理并给出可操作提示。 */
    async loadSystemFonts(force = false) {
      if (this.loading) return;
      if (!force && this.fonts.length > 0) return;

      this.fontError = '';
      const queryLocalFonts = window.queryLocalFonts?.bind(window);
      if (!queryLocalFonts) {
        this.fontError = this.$t('settings.lyricsFont.unsupported');
        return;
      }

      this.loading = true;
      try {
        const list = await queryLocalFonts();
        const seen = new Map();
        for (const item of list) {
          const family = (item.family || '').trim();
          if (!family) continue;
          const key = family.toLocaleLowerCase();
          if (seen.has(key)) continue;
          seen.set(key, {
            family,
            cssFamily: buildFontFamilyCss([family]),
            // 可用性用画布测量（不额外申请权限）：装了但量不出来的记为不可用
            unavailable: !isFontFamilyAvailableCached(family),
          });
        }
        this.fonts = [...seen.values()].sort((a, b) =>
          a.family.localeCompare(b.family)
        );
        this.loadedOnce = true;
      } catch (error) {
        console.warn('[fonts] queryLocalFonts 失败', error);
        this.fontError = this.$t('settings.lyricsFont.permissionDenied');
        this.loadedOnce = true;
      } finally {
        this.loading = false;
      }
    },
    async handleFile(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      this.fontError = '';
      try {
        const { family, label } = await uploadFont(file);
        this.uploadedLabel = label;
        this.$store.commit('updateSettings', {
          key: 'lyricsFontPreset',
          value: 'custom',
        });
        this.$store.commit('updateSettings', {
          key: 'lyricsFontFamily',
          value: family,
        });
      } catch (error) {
        this.fontError = String(error?.message || error);
      }
    },
    async removeUploaded() {
      await clearUploadedFont();
      this.uploadedLabel = '';
      if (this.settings.lyricsFontPreset === 'custom') {
        this.$store.commit('updateSettings', {
          key: 'lyricsFontPreset',
          value: 'app',
        });
        this.$store.commit('updateSettings', {
          key: 'lyricsFontFamily',
          value: null,
        });
      }
    },
    async refreshUploadedLabel() {
      const restored = await restoreUploadedFont();
      if (restored) this.uploadedLabel = restored.label;
    },
  },
};
</script>

<style lang="scss" scoped>
.lyrics-font-picker {
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .left {
    .title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text);
    }

    .description {
      margin-top: 4px;
      font-size: 13px;
      opacity: 0.58;
    }
  }

  button {
    cursor: pointer;
    padding: 6px 14px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    color: var(--color-text);
    background: var(--color-secondary-bg-for-transparent);
    transition: 0.2s;

    &:hover {
      background: var(--color-shape-color);
    }

    &.active {
      color: var(--color-primary);
      box-shadow: inset 0 0 0 1px var(--color-primary);
    }
  }

  .panel {
    margin: -4px 0 20px;
    padding: 16px;
    border-radius: 12px;
    background: var(--color-secondary-bg-for-transparent);
  }

  .section {
    & + .section {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid var(--color-shape-color);
    }
  }

  .section-title {
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
    opacity: 0.7;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    button {
      min-width: 84px;
    }
  }

  .preview {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--color-secondary-bg);
    color: var(--color-text);

    .preview-line {
      font-size: 18px;
      line-height: 1.6;

      &.secondary {
        margin-top: 6px;
        font-size: 13px;
        opacity: 0.6;
      }
    }
  }

  .system-row {
    display: flex;
    gap: 8px;

    .search {
      flex: 1;
      min-width: 0;
      padding: 7px 10px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      color: var(--color-text);
      background: var(--color-secondary-bg);
      outline: none;

      &::placeholder {
        color: var(--color-text);
        opacity: 0.4;
      }
    }
  }

  .font-list {
    margin-top: 10px;
    max-height: 220px;
    overflow-y: auto;
    border-radius: 10px;
    background: var(--color-secondary-bg);
  }

  .font-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 12px;
    border-radius: 0;
    background: transparent;
    text-align: left;

    &:hover {
      background: var(--color-shape-color);
    }

    &.active {
      box-shadow: none;
      background: var(--color-shape-color);
    }

    &.unavailable {
      opacity: 0.45;
    }

    .name {
      font-size: 15px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tag {
      flex-shrink: 0;
      margin-left: 8px;
      font-size: 11px;
      opacity: 0.7;
    }
  }

  .upload-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;

    .upload-button {
      position: relative;
      overflow: hidden;
      cursor: pointer;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      background: var(--color-secondary-bg);

      input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
    }

    .uploaded {
      font-size: 13px;
      opacity: 0.8;
    }
  }

  .hint {
    margin-top: 8px;
    font-size: 12px;
    opacity: 0.5;

    &.error {
      opacity: 0.9;
      color: var(--color-red, #d33);
    }
  }
}
</style>
