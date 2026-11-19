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
      <!-- 预览：跟着当前选择实时变化 -->
      <div class="section">
        <div class="section-title">{{ $t('settings.lyricsFont.preview') }}</div>
        <div class="preview" :style="{ fontFamily: currentFamily }">
          <div class="preview-line">{{ previewText }}</div>
          <div class="preview-line secondary">
            The quick brown fox jumps over the lazy dog
          </div>
        </div>
      </div>

      <!-- 选择：共享组件（预设 + 本机字体，与远程窗的齿轮面板同一实现） -->
      <div class="section">
        <FontChooser
          :value="chooserValue"
          :presets="chooserPresets"
          :preview-stack="currentFamily"
          @change="onChooserChange"
        />
      </div>

      <!-- 上传字体：只有设置页提供 -->
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
        <div v-if="uploadError" class="hint error">{{ uploadError }}</div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * 设置页的"歌词字体"（M2-B）。
 *
 * 字体选择本身交给共享组件 FontChooser（预设 + 本机字体，与远程窗齿轮面板同一实现）；
 * 这里只负责设置页特有的部分：折叠外壳、实时预览、上传字体（FontFace + IndexedDB，
 * 见 settings/customFont.ts）以及把选择写回 store。
 */
import { mapState } from 'vuex';
import FontChooser from '@/components/FontChooser.vue';
import { resolveLyricsFontFamily } from '@/settings/fontStacks';
import {
  clearUploadedFont,
  restoreUploadedFont,
  uploadFont,
} from '@/settings/customFont';

const PREVIEW_TEXT = '夜空中最亮的星 能否听清';

export default {
  name: 'LyricsFontPicker',
  components: { FontChooser },
  data() {
    return {
      open: false,
      uploadedLabel: '',
      uploadError: '',
    };
  },
  computed: {
    ...mapState(['settings']),
    /** FontChooser 的取值模型：{ preset, family } */
    chooserValue() {
      return {
        preset: this.settings.lyricsFontPreset || 'app',
        family: this.settings.lyricsFontFamily || null,
      };
    },
    chooserPresets() {
      return ['app', 'sans', 'serif', 'mono'].map(value => ({
        value,
        labelKey: `settings.lyricsFont.presetLabels.${value}`,
        preview: resolveLyricsFontFamily({ lyricsFontPreset: value }),
      }));
    },
    /** 当前字体在标题旁显示的文案与预览用的字体栈 */
    currentLabel() {
      const preset = this.settings.lyricsFontPreset || 'app';
      if (preset === 'custom') {
        return (
          (this.settings.lyricsFontFamily || '').trim() ||
          this.$t('settings.lyricsFont.notChosen')
        );
      }
      return this.$t(`settings.lyricsFont.presetLabels.${preset}`);
    },
    currentFamily() {
      return resolveLyricsFontFamily(this.settings);
    },
    previewText() {
      return PREVIEW_TEXT;
    },
  },
  mounted() {
    this.refreshUploadedLabel();
  },
  methods: {
    onChooserChange({ preset, family }) {
      this.$store.commit('updateSettings', {
        key: 'lyricsFontPreset',
        value: preset,
      });
      this.$store.commit('updateSettings', {
        key: 'lyricsFontFamily',
        value: family,
      });
    },
    async handleFile(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      this.uploadError = '';
      try {
        const { family, label } = await uploadFont(file);
        this.uploadedLabel = label;
        this.onChooserChange({ preset: 'custom', family });
      } catch (error) {
        this.uploadError = String(error?.message || error);
      }
    },
    async removeUploaded() {
      await clearUploadedFont();
      this.uploadedLabel = '';
      if (this.settings.lyricsFontPreset === 'custom') {
        this.onChooserChange({ preset: 'app', family: null });
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
  }

  .uploaded-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;

    .uploaded {
      font-size: 13px;
      opacity: 0.8;
    }

    .ghost {
      padding: 3px 10px;
      font-size: 12px;
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
