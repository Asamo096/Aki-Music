<template>
  <div
    ref="root"
    class="vue-slider vue-slider-ltr"
    :class="{ 'vue-slider-disabled': disabled }"
    :style="{ height: `${height}px` }"
    role="slider"
    :aria-valuenow="currentValue"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :tabindex="disabled ? -1 : 0"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
    @focus="focus = true"
    @blur="focus = false"
  >
    <div class="vue-slider-rail" />
    <div class="vue-slider-process" :style="processStyle" />
    <div class="vue-slider-dot" :style="dotStyle">
      <div class="vue-slider-dot-handle" />
      <div
        class="vue-slider-dot-tooltip-wrapper"
        :class="{ 'vue-slider-dot-tooltip-wrapper-show': tooltipVisible }"
      >
        <div class="vue-slider-dot-tooltip">
          <div class="vue-slider-dot-tooltip-inner">{{ tooltipText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * 本地滑杆组件（替代 vue-slider-component）。
 *
 * 为什么换掉：这个包 3.2.x 的所有发布产物在模块内部 `require('vue')`，在 Vite 的
 * 打包产物里会解析成**第二份 Vue 运行时**。那份运行时渲染时会在
 * `config.getTagNamespace()` 处抛 `Cannot read properties of undefined
 * (reading 'toLowerCase')`（打包版每次渲染滑杆都刷屏，开发版因为依赖预打包走同一份
 * Vue 才不出现）。我们只用到它 4 处最简单的用法，本地实现既能保证"全应用一份 Vue"，
 * 也顺手去掉了这个已停止维护的依赖。
 *
 * **Class 名与 DOM 结构刻意与上游保持一致**（vue-slider / -rail / -process /
 * -dot / -dot-handle / -dot-tooltip*），这样 `src/assets/css/slider.css` 里
 * 现成的样式（含 nyancat、歌词页深浅色）无需改动即可继续生效。
 *
 * 支持的用法（与现有调用点一一对应）：
 *   v-model（input 事件）、min / max / interval、drag-on-click、lazy（拖拽结束才提交）、
 *   tooltip（none | always | focus）、tooltip-formatter、dot-size、height
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default {
  name: 'AkiSlider',
  props: {
    value: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    interval: { type: Number, default: 1 },
    dotSize: { type: Number, default: 12 },
    height: { type: Number, default: 4 },
    /** 'none' | 'always' | 'focus'（hover 时也会显示） */
    tooltip: { type: String, default: 'focus' },
    tooltipFormatter: { type: Function, default: null },
    /** 拖拽过程中不提交，松手才提交（进度条用） */
    lazy: { type: Boolean, default: false },
    /** 上游参数，这里与 lazy 等价（保持调用点兼容） */
    silent: { type: Boolean, default: false },
    dragOnClick: { type: Boolean, default: true },
    /** 上游的过渡时长；本实现不做值动画，仅接收以避免属性警告 */
    duration: { type: Number, default: 0 },
    disabled: { type: Boolean, default: false },
  },
  data() {
    return {
      dragging: false,
      /** 拖拽中的本地值：lazy 模式下不立即提交 */
      dragValue: null,
      hover: false,
      focus: false,
    };
  },
  computed: {
    /** 当前展示的值：拖拽中优先用本地值，避免受控值滞后导致滑块回跳 */
    currentValue() {
      if (this.dragValue !== null) return this.dragValue;
      const max = this.safeMax;
      return Number.isFinite(this.value)
        ? clamp(this.value, this.min, max)
        : this.min;
    },
    safeMax() {
      // 时长/上限可能暂时是 0 或 NaN（切歌瞬间），不能让它把比例算成 NaN
      const max = Number(this.max);
      if (!Number.isFinite(max) || max <= this.min) return this.min;
      return max;
    },
    percent() {
      const range = this.safeMax - this.min;
      if (range <= 0) return 0;
      return clamp(((this.currentValue - this.min) / range) * 100, 0, 100);
    },
    processStyle() {
      return { width: `${this.percent}%` };
    },
    dotStyle() {
      return {
        left: `${this.percent}%`,
        width: `${this.dotSize}px`,
        height: `${this.dotSize}px`,
      };
    },
    tooltipVisible() {
      if (this.tooltip === 'none') return false;
      if (this.tooltip === 'always') return true;
      return this.dragging || this.hover || this.focus;
    },
    tooltipText() {
      const value = this.currentValue;
      try {
        return this.tooltipFormatter ? this.tooltipFormatter(value) : value;
      } catch {
        return value;
      }
    },
  },
  beforeDestroy() {
    this.removeDragListeners();
  },
  methods: {
    /** 把指针位置换算成值（吸附到 interval） */
    valueFromEvent(event) {
      const rect = this.$refs.root?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return this.currentValue;
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const range = this.safeMax - this.min;
      const raw = this.min + ratio * range;
      const step = this.interval > 0 ? this.interval : range;
      const snapped = this.min + Math.round((raw - this.min) / step) * step;
      return clamp(Number(snapped.toFixed(6)), this.min, this.safeMax);
    },
    emitValue(value) {
      this.$emit('input', value);
      this.$emit('change', value);
    },
    onPointerDown(event) {
      if (this.disabled) return;
      // 点轨道也能跳转；dragOnClick=false 时只允许从滑块本体开始拖
      const onDot = event.target?.closest?.('.vue-slider-dot');
      if (!this.dragOnClick && !onDot) return;

      event.preventDefault();
      const value = this.valueFromEvent(event);
      this.dragging = true;
      this.dragValue = value;
      if (!this.lazy && !this.silent) this.emitValue(value);
      this.addDragListeners();
      this.$refs.root?.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event) {
      if (!this.dragging) return;
      const value = this.valueFromEvent(event);
      if (value === this.dragValue) return;
      this.dragValue = value;
      if (!this.lazy && !this.silent) this.emitValue(value);
    },
    onPointerUp() {
      if (!this.dragging) return;
      this.dragging = false;
      const value = this.dragValue;
      this.dragValue = null;
      this.removeDragListeners();
      if (this.lazy || this.silent) this.emitValue(value);
    },
    addDragListeners() {
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerUp);
    },
    removeDragListeners() {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
    },
    onKeydown(event) {
      if (this.disabled) return;
      const step = this.interval > 0 ? this.interval : 1;
      let next = null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
        next = this.currentValue - step;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
        next = this.currentValue + step;
      else if (event.key === 'Home') next = this.min;
      else if (event.key === 'End') next = this.safeMax;
      if (next === null) return;

      event.preventDefault();
      this.emitValue(clamp(Number(next.toFixed(6)), this.min, this.safeMax));
    },
  },
};
</script>

<style scoped>
.vue-slider {
  position: relative;
  display: block;
  width: 100%;
  cursor: pointer;
  outline: none;
  touch-action: none;
  user-select: none;
}

.vue-slider-rail,
.vue-slider-process {
  position: absolute;
  top: 50%;
  height: 50%;
  transform: translateY(-50%);
  border-radius: 15px;
}

.vue-slider-rail {
  left: 0;
  width: 100%;
  background-color: rgba(128, 128, 128, 0.18);
}

.vue-slider-process {
  left: 0;
  background-color: #335eea;
}

.vue-slider-dot {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  margin-top: 1px;
  transform-origin: center;
}

.vue-slider-dot-handle {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-color: #fff;
  box-shadow: 0.5px 0.5px 2px 1px rgba(0, 0, 0, 0.12);
  visibility: hidden;
}

.vue-slider:hover .vue-slider-dot-handle,
.vue-slider:active .vue-slider-dot-handle,
.vue-slider:focus .vue-slider-dot-handle {
  visibility: visible;
}

.vue-slider-dot-tooltip-wrapper {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translate(-50%, -6px);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: 10;
}

.vue-slider-dot-tooltip-wrapper-show {
  opacity: 1;
}

.vue-slider-dot-tooltip-inner {
  padding: 2px 6px;
  min-width: 20px;
  font-size: 14px;
  text-align: center;
  white-space: nowrap;
  color: #000;
  border-radius: 5px;
  border-color: #fff;
  background-color: #fff;
  box-sizing: content-box;
  box-shadow: 0.5px 0.5px 2px 1px rgba(0, 0, 0, 0.08);
}

.vue-slider-disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
