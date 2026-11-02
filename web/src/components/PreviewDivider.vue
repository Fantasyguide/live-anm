<script setup>
import { ref } from 'vue';

const props = defineProps({ workspace: Object });
const share = defineModel({ default: 32 });
const resizing = ref(false);
let startX = 0, startWidth = 0;

function setShare(value) {
  const el = props.workspace;
  if (!el) return;
  const width = el.getBoundingClientRect().width;
  const css = getComputedStyle(el);
  const minPane = parseFloat(css.getPropertyValue('--pane-min-width'));
  const sidebar = parseFloat(css.getPropertyValue('--sidebar-width'));
  const divider = parseFloat(css.getPropertyValue('--divider-width'));
  const gaps = parseFloat(css.columnGap) * 3;
  const min = minPane / width * 100;
  const max = (width - sidebar - minPane - divider - gaps) / width * 100;
  share.value = Math.max(min, Math.min(max, value));
}
function start(event) {
  if (event.button !== 0 || !props.workspace) return;
  event.preventDefault();
  startX = event.clientX;
  startWidth = props.workspace.lastElementChild.getBoundingClientRect().width;
  event.currentTarget.setPointerCapture(event.pointerId);
  resizing.value = true;
}
function move(event) {
  if (!resizing.value) return;
  const width = props.workspace.getBoundingClientRect().width;
  setShare((startWidth + startX - event.clientX) / width * 100);
}
function end(event) {
  resizing.value = false;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}
function onKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key) || !props.workspace) return;
  event.preventDefault();
  if (event.key === 'Home') { share.value = 32; return; }
  const el = props.workspace;
  const current = el.lastElementChild.getBoundingClientRect().width / el.getBoundingClientRect().width * 100;
  setShare(current + (event.key === 'ArrowLeft' ? 2 : -2));
}
</script>

<template>
  <div class="preview-divider" :class="{ resizing }" role="separator" tabindex="0"
       aria-label="调整右侧预览区宽度" aria-orientation="vertical" :aria-valuenow="Math.round(share)"
       aria-controls="preview-pane" title="左右拖拽调整预览区宽度，双击恢复默认；也可使用方向键和 Home 键"
       @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end"
       @lostpointercapture="resizing = false" @keydown="onKeydown" @dblclick="share = 32"></div>
</template>

<style scoped>
.preview-divider { position: relative; cursor: col-resize; touch-action: none; user-select: none;
                   background: var(--bg); outline-offset: -2px; }
.preview-divider::after { content: ''; position: absolute; top: calc(50% - 18px); left: calc(50% - 1px);
                         width: 2px; height: 36px; border-radius: 2px; background: var(--dim); }
.preview-divider:hover, .preview-divider.resizing, .preview-divider:focus-visible { background: var(--panel); }
.preview-divider:hover::after, .preview-divider.resizing::after, .preview-divider:focus-visible::after { background: var(--acc); }
@media (max-width: 1100px) { .preview-divider { display: none; } }
</style>
