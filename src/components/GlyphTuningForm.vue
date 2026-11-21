<template>
  <div class="glyph-tuning" :class="{ compact }">
    <div v-if="showTitle" class="tuning-title">
      <span>{{ $t('settings.visual.glyphTuning') }}</span>
      <button type="button" class="reset" @click="reset">
        {{ $t('settings.visual.resetTuning') }}
      </button>
    </div>
    <div v-for="field in fields" :key="field.key" class="row">
      <span class="label">{{ $t(field.labelKey) }}</span>
      <input
        type="range"
        :min="field.range.min"
        :max="field.range.max"
        :step="field.range.step"
        :value="resolved[field.key]"
        @input="onInput(field.key, $event)"
      />
      <span class="value">{{ display(field) }}</span>
    </div>
  </div>
</template>

<script>
/**
 * 逐字歌词调参（主设置页 / 远程窗共用）。
 * 只负责展示与 emit change({ key, value }) / reset；落库由父组件决定。
 */
import {
  DEFAULT_GLYPH_TUNING,
  GLYPH_TUNING_RANGES,
  normalizeGlyphTuning,
} from '@/visual/glyph/tuning';

export default {
  name: 'GlyphTuningForm',
  props: {
    value: { type: Object, default: () => ({}) },
    compact: { type: Boolean, default: false },
    showTitle: { type: Boolean, default: true },
    /** 缺省值的 fallback（桌面传 entry=0.5 的那套） */
    fallback: { type: Object, default: null },
  },
  computed: {
    resolved() {
      return normalizeGlyphTuning(
        this.value,
        this.fallback || DEFAULT_GLYPH_TUNING
      );
    },
    fields() {
      return [
        {
          key: 'tiltMaxDeg',
          labelKey: 'settings.visual.tilt',
          unit: '°',
          precision: 0,
          range: GLYPH_TUNING_RANGES.tiltMaxDeg,
        },
        {
          key: 'riseScale',
          labelKey: 'settings.visual.rise',
          unit: '×',
          precision: 2,
          range: GLYPH_TUNING_RANGES.riseScale,
        },
        {
          key: 'spacingRatio',
          labelKey: 'settings.visual.spacing',
          unit: '×',
          precision: 2,
          range: GLYPH_TUNING_RANGES.spacingRatio,
        },
        {
          key: 'entryDurationScale',
          labelKey: 'settings.visual.entry',
          unit: '×',
          precision: 2,
          range: GLYPH_TUNING_RANGES.entryDurationScale,
        },
        {
          key: 'glowScale',
          labelKey: 'settings.visual.glow',
          unit: '×',
          precision: 2,
          range: GLYPH_TUNING_RANGES.glowScale,
        },
      ];
    },
  },
  methods: {
    display(field) {
      const value = this.resolved[field.key];
      return `${Number(value).toFixed(field.precision)}${field.unit}`;
    },
    onInput(key, event) {
      const next = normalizeGlyphTuning(
        { ...this.resolved, [key]: Number(event.target.value) },
        this.fallback || DEFAULT_GLYPH_TUNING
      );
      this.$emit('change', { key, value: next[key] });
    },
    reset() {
      this.$emit('reset');
    },
  },
};
</script>

<style lang="scss" scoped>
.glyph-tuning {
  margin: 8px 0 14px;
  color: inherit;

  .tuning-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 2px 0 8px;
    font-size: 14px;
    font-weight: 600;
    opacity: 0.75;

    .reset {
      padding: 2px 8px;
      border: 1px solid currentColor;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.5;
      opacity: 0.8;
      cursor: pointer;

      &:hover {
        opacity: 1;
        background: rgba(127, 127, 127, 0.14);
      }
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    font-size: 13px;
  }

  .label {
    width: 76px;
    flex-shrink: 0;
    opacity: 0.75;
  }

  input[type='range'] {
    flex: 1;
    min-width: 60px;
    accent-color: var(--color-primary, #335eea);
  }

  .value {
    width: 48px;
    flex-shrink: 0;
    text-align: right;
    opacity: 0.65;
    font-variant-numeric: tabular-nums;
  }

  &.compact {
    margin: 4px 0 10px;

    .tuning-title {
      font-size: 12px;
      margin-bottom: 4px;

      .reset {
        padding: 1px 6px;
        font-size: 10px;
      }
    }

    .row {
      height: 26px;
      font-size: 11px;
      gap: 8px;
    }

    .label {
      width: 60px;
    }

    .value {
      width: 38px;
    }

    input[type='range'] {
      height: 16px;
    }
  }
}
</style>
