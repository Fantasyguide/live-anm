<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createGifPlan } from '../gif-plan.js';
import { download } from '../doc.js';

const props = defineProps({ file: Object, scriptIndex: Number, fileName: String, view: Object, spawnAt: Object });
const emit = defineEmits(['crop-change']);
const expanded = ref(false);
const crop = ref({ x: 0, y: 0, width: 640, height: 480 });
const duration = ref(3);
const fps = ref(20);
const loop = ref(true);
const busy = ref(false);
const progress = ref({ done: 0, total: 0 });
const message = ref('');
const exportError = ref('');
let controller;

function fullCanvas() {
  crop.value = { x: 0, y: 0, width: props.view.w, height: props.view.h };
}
watch(() => [props.view.w, props.view.h], fullCanvas, { immediate: true });
const options = computed(() => ({
  width: props.view.w, height: props.view.h, crop: { ...crop.value },
  duration: duration.value, fps: fps.value, loop: loop.value,
}));
const validation = computed(() => {
  try { return { plan: createGifPlan(options.value), error: '' }; }
  catch (e) { return { plan: null, error: e.message }; }
});
watch([validation, expanded], () => {
  emit('crop-change', expanded.value ? validation.value.plan?.crop ?? null : null);
}, { immediate: true });

async function exportGif() {
  if (busy.value || !validation.value.plan || !props.file || props.scriptIndex < 0) return;
  // 导出期间仍可浏览其他脚本，始终使用点击时的文件、范围和生成位置。
  const request = {
    file: props.file, scriptIndex: props.scriptIndex, options: options.value,
    entityPos: { x: props.spawnAt.x, y: props.spawnAt.y, z: 0 },
    name: `${(props.fileName || 'animation.anm').replace(/\.anm$/i, '')}-script${props.scriptIndex}.gif`,
  };
  busy.value = true;
  message.value = ''; exportError.value = '';
  progress.value = { done: 0, total: validation.value.plan.frames.length };
  controller = new AbortController();
  try {
    const { exportAnmGif } = await import('../gif-export.js');
    const bytes = await exportAnmGif(request.file, request.scriptIndex, {
      ...request.options, entityPos: request.entityPos, signal: controller.signal,
      onProgress: (done, total) => { progress.value = { done, total }; },
    });
    download(bytes, request.name, 'image/gif');
    message.value = `已生成 ${request.options.crop.width} × ${request.options.crop.height} 的 GIF，下载已开始`;
  } catch (e) {
    if (e.name === 'AbortError') message.value = '已取消导出';
    else exportError.value = `GIF 导出失败：${e.message}`;
  } finally { busy.value = false; }
}
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <details class="gif-panel" @toggle="expanded = $event.target.open">
    <summary>导出 GIF</summary>
    <div class="gif-body">
      <p class="dim tiny">从头导出最近应用到预览的脚本，使用当前生成位置和黑色背景。</p>
      <fieldset :disabled="busy">
        <div class="grid2">
          <label>时长（秒）<input v-model.number="duration" type="number" min="0.1" max="30" step="0.1" class="num"></label>
          <label>帧率<select v-model.number="fps" class="num"><option :value="10">10fps</option><option :value="20">20fps</option><option :value="30">30fps</option></select></label>
        </div>
        <div class="bar">
          <b>导出范围</b><button @click="fullCanvas">整张画布</button>
        </div>
        <div class="grid2">
          <label>左边距 X<input v-model.number="crop.x" type="number" min="0" class="num"></label>
          <label>上边距 Y<input v-model.number="crop.y" type="number" min="0" class="num"></label>
          <label>宽<input v-model.number="crop.width" type="number" min="1" :max="view.w" class="num"></label>
          <label>高<input v-model.number="crop.height" type="number" min="1" :max="view.h" class="num"></label>
        </div>
        <label class="dim tiny"><input v-model="loop" type="checkbox"> 循环播放</label>
      </fieldset>
      <p v-if="validation.error" class="warn tiny">{{ validation.error }}</p>
      <p v-else-if="scriptIndex < 0 || !file" class="dim tiny">请先选择脚本并应用到预览。</p>
      <div class="bar">
        <button @click="exportGif" :disabled="busy || !!validation.error || scriptIndex < 0 || !file">生成并下载 GIF</button>
        <button v-if="busy" @click="controller?.abort()">取消</button>
      </div>
      <div v-if="busy" class="gif-progress" role="status">
        <progress :value="progress.done" :max="progress.total"></progress>
        <span class="dim tiny">{{ progress.done }} / {{ progress.total }} 帧</span>
      </div>
      <p v-if="message" class="dim tiny" role="status">{{ message }}</p>
      <p v-if="exportError" class="warn tiny" role="alert">{{ exportError }}</p>
    </div>
  </details>
</template>

<style scoped>
.gif-panel { margin: 12px 0; padding: 8px; border: 1px solid var(--line); border-radius: 6px; }
summary { cursor: pointer; font-size: 12px; }
.gif-body { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
.gif-body p { margin: 0; }
fieldset { display: flex; flex-direction: column; gap: 10px; min-width: 0; border: 0; padding: 0; margin: 0; }
.grid2 label { justify-content: space-between; }
.grid2 .num { width: 74px; }
.gif-progress { display: flex; align-items: center; gap: 8px; }
progress { flex: 1; min-width: 0; accent-color: var(--acc); }
</style>
