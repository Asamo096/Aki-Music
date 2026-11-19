<template>
  <div class="font-chooser" :class="{ compact }">
    <!-- 当前选择：点开列表 -->
    <button
      class="font-current"
      :class="{ open }"
      :style="currentPreviewStyle"
      @click="toggle"
    >
      <span class="font-current-name">{{ currentLabel }}</span>
      <svg-icon icon-class="dropdown" />
    </button>

    <div v-if="open" class="font-list">
      <!-- 预设 -->
      <button
        v-for="preset in presets"
        :key="preset.value"
        class="font-item"
        :class="{ active: value.preset === preset.value }"
        :style="preset.preview ? { fontFamily: preset.preview } : null"
        @click="choosePreset(preset.value)"
      >
        {{ $t(preset.labelKey) }}
      </button>

      <!-- 本机字体 -->
      <div class="font-divider">
        <span>{{ $t('settings.lyricsFont.system') }}</span>
        <button
          class="font-load"
          :disabled="loading"
          @click="ensureSystemFonts"
        >
          {{
            loading
              ? $t('settings.lyricsFont.loading')
              : $t('settings.lyricsFont.loadSystem')
          }}
        </button>
      </div>

      <input
        v-model="search"
        class="font-search"
        type="text"
        :placeholder="$t('settings.lyricsFont.search')"
        @focus="ensureSystemFonts"
      />

      <div v-if="error" class="font-hint font-error">{{ error }}</div>
      <template v-else>
        <button
          v-for="font in visibleSystemFonts"
          :key="font.family"
          class="font-item"
          :class="{
            active: value.preset === 'custom' && value.family === font.family,
            unavailable: font.unavailable,
          }"
          :style="{ fontFamily: font.cssFamily }"
          @click="chooseSystemFont(font)"
        >
          {{ font.family }}
        </button>
        <div v-if="loaded && visibleSystemFonts.length === 0" class="font-hint">
          {{ $t('settings.lyricsFont.empty') }}
        </div>
      </template>

      <!-- 额外内容（设置页用它放"上传字体"） -->
      <slot name="footer" />
    </div>
  </div>
</template>

<script>
/**
 * 共享的字体选择器（M2-B / M3 远程面板合并后的单点实现）。
 *
 * 两处用法：
 *   - 设置页的"歌词字体"（宽面板，附带预览与上传，见 LyricsFontPicker）
 *   - 远程窗齿轮面板的"桌面歌词字体"（compact，紧凑列表）
 *
 * 组件只负责**选择**：读系统字体、去重、可用性标记、搜索、列表渲染与当前值显示。
 * 值的落库由父组件决定（设置页直接 commit；远程窗经 IPC 交给主窗口），
 * 因此这里只 `emit('change', { preset, family })`，不碰任何 store。
 */
import { filterSystemFonts, loadSystemFonts } from '@/settings/systemFonts';

export default {
  name: 'FontChooser',
  props: {
    /** 当前值：{ preset, family }（family 仅 preset === 'custom' 时有意义） */
    value: {
      type: Object,
      default: () => ({ preset: 'app', family: null }),
    },
    /** 可选预设：[{ value, labelKey, preview? }] */
    presets: {
      type: Array,
      default: () => [],
    },
    /** 当前字体在按钮上的预览（CSS font-family）；不传则按预设栈取首项 */
    previewStack: {
      type: String,
      default: '',
    },
    /** 紧凑模式（远程窗小面板） */
    compact: {
      type: Boolean,
      default: false,
    },
    /** 初始是否展开列表 */
    startOpen: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      open: this.startOpen,
      search: '',
      systemFonts: [],
      loaded: false,
      loading: false,
      error: '',
    };
  },
  computed: {
    currentLabel() {
      const { preset, family } = this.value;
      if (preset === 'custom') {
        return family || this.$t('settings.lyricsFont.notChosen');
      }
      const matched = this.presets.find(item => item.value === preset);
      return matched
        ? this.$t(matched.labelKey)
        : this.$t('settings.lyricsFont.notChosen');
    },
    currentPreviewStyle() {
      const stack =
        this.previewStack ||
        this.presets.find(item => item.value === this.value.preset)?.preview ||
        '';
      // 只取栈首字体给按钮做预览
      return stack ? { fontFamily: stack.split(',')[0].trim() } : null;
    },
    visibleSystemFonts() {
      return filterSystemFonts(this.systemFonts, this.search);
    },
  },
  methods: {
    toggle() {
      this.open = !this.open;
      if (this.open) this.ensureSystemFonts();
    },
    async ensureSystemFonts() {
      if (this.loading || this.loaded) return;
      this.loading = true;
      this.error = '';
      try {
        this.systemFonts = await loadSystemFonts();
        this.loaded = true;
      } catch (err) {
        // unsupported / 权限被拒：给出可操作提示，预设仍然可用
        this.error =
          err && String(err.message) === 'unsupported'
            ? this.$t('settings.lyricsFont.unsupported')
            : this.$t('settings.lyricsFont.permissionDenied');
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },
    choosePreset(preset) {
      this.open = false;
      this.$emit('change', { preset, family: null });
    },
    chooseSystemFont(font) {
      this.open = false;
      this.$emit('change', { preset: 'custom', family: font.family });
    },
  },
};
</script>

<style lang="scss" scoped>
.font-chooser {
  .font-current {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 230px;
    padding: 6px 12px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    color: var(--color-text);
    cursor: pointer;
    background: var(--color-secondary-bg-for-transparent);
    transition: 0.2s;

    &:hover,
    &.open {
      background: var(--color-shape-color);
    }

    .font-current-name {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .svg-icon {
      width: 10px;
      height: 10px;
      opacity: 0.55;
      flex-shrink: 0;
    }
  }

  .font-list {
    margin-top: 8px;
    max-height: 260px;
    overflow-y: auto;
    border-radius: 10px;
    background: var(--color-secondary-bg);
    scrollbar-width: thin;
  }

  .font-item {
    display: block;
    width: 100%;
    padding: 7px 12px;
    border: none;
    border-radius: 0;
    text-align: left;
    font-size: 14px;
    font-family: inherit;
    color: var(--color-text);
    cursor: pointer;
    background: transparent;

    &:hover {
      background: var(--color-shape-color);
    }

    &.active {
      background: color-mix(in srgb, var(--color-primary) 22%, transparent);
    }

    &.unavailable {
      opacity: 0.45;
    }
  }

  .font-divider {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    padding: 6px 12px 2px;
    font-size: 12px;
    opacity: 0.6;

    .font-load {
      padding: 2px 8px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      cursor: pointer;
      background: var(--color-secondary-bg-for-transparent);

      &:hover {
        background: var(--color-shape-color);
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }

  .font-search {
    width: calc(100% - 24px);
    margin: 6px 12px 4px;
    padding: 5px 10px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    color: var(--color-text);
    background: var(--color-secondary-bg-for-transparent);
    outline: none;

    &::placeholder {
      color: var(--color-text);
      opacity: 0.45;
    }
  }

  .font-hint {
    padding: 8px 12px;
    font-size: 12px;
    opacity: 0.55;
  }

  /* ── 紧凑模式：远程窗的暗色小面板 ── */
  &.compact {
    .font-current {
      max-width: 190px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
      color: inherit;
      background: rgba(255, 255, 255, 0.1);

      &:hover,
      &.open {
        background: rgba(255, 255, 255, 0.16);
      }

      .font-current-name {
        max-width: 160px;
      }
    }

    .font-list {
      margin-top: 2px;
      max-height: 190px;
      background: rgba(0, 0, 0, 0.22);
    }

    .font-item {
      padding: 4px 9px;
      font-size: 12px;
      color: inherit;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      &.active {
        background: rgba(120, 170, 255, 0.4);
      }
    }

    .font-divider {
      margin-top: 4px;
      padding: 4px 9px 2px;
      font-size: 11px;
    }

    .font-search {
      width: calc(100% - 18px);
      margin: 4px 9px 2px;
      padding: 3px 7px;
      border-radius: 6px;
      font-size: 12px;
      color: inherit;
      background: rgba(255, 255, 255, 0.1);

      &::placeholder {
        color: inherit;
        opacity: 0.45;
      }
    }

    .font-hint {
      padding: 6px 9px;
      font-size: 11px;
    }
  }
}
</style>
