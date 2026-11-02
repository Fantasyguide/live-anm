<script setup>
import { computed, ref, watch } from 'vue';
import { decodeThtx } from '@engine/format/thtx.js';
import { spritePreviewLayout } from '../sprite-preview.js';

const props = defineProps({ entry: Object, sprite: Object, spriteIndex: Number });
const atlasCanvas = ref(null);
const sliceCanvas = ref(null);
const drawError = ref('');

// 同一 entry 内改选切片、修改坐标都沿用已解码的贴图，不依赖脚本汇编或播放器重建。
const image = computed(() => {
  const raw = props.entry?.thtxRaw;
  if (!raw) return { texture: null, error: '这个贴图条目没有内嵌图片，无法显示静态预览。' };
  try {
    const texture = decodeThtx(raw, 0);
    if (!texture.width || !texture.height) throw new Error('贴图尺寸为空');
    return { texture, error: '' };
  } catch (e) { return { texture: null, error: `无法读取这张贴图：${e.message}` }; }
});
const geometry = computed(() => {
  if (!props.sprite || !image.value.texture) return { layout: null, error: '' };
  try { return { layout: spritePreviewLayout(props.sprite, image.value.texture), error: '' }; }
  catch (e) { return { layout: null, error: e.message }; }
});
const outlineStyle = computed(() => {
  const rect = geometry.value.layout?.outline;
  return rect ? { left: rect.left + '%', top: rect.top + '%', width: rect.width + '%', height: rect.height + '%' } : {};
});

function drawSlice() {
  const layout = geometry.value.layout;
  if (!sliceCanvas.value || !atlasCanvas.value || !layout) return;
  try {
    const canvas = sliceCanvas.value;
    canvas.width = layout.size.width; canvas.height = layout.size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建图片预览');
    ctx.imageSmoothingEnabled = false;
    const { x, y, w, h } = props.sprite;
    // Canvas 裁切会把源图范围外的部分留空，原始坐标不做钳制。
    ctx.drawImage(atlasCanvas.value, x, y, w, h, 0, 0, canvas.width, canvas.height);
    drawError.value = '';
  } catch (e) { drawError.value = e.message; }
}
function drawAtlas() {
  const texture = image.value.texture;
  if (!atlasCanvas.value || !texture) return;
  try {
    const canvas = atlasCanvas.value;
    canvas.width = texture.width; canvas.height = texture.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建图片预览');
    const pixels = ctx.createImageData(texture.width, texture.height);
    pixels.data.set(texture.rgba);
    ctx.putImageData(pixels, 0, 0);
    drawError.value = '';
    drawSlice();
  } catch (e) { drawError.value = e.message; }
}
watch([atlasCanvas, () => image.value.texture], drawAtlas, { flush: 'post' });
watch([sliceCanvas, () => geometry.value.layout], drawSlice, { flush: 'post' });
</script>

<template>
  <div class="sprite-preview">
    <template v-if="sprite">
      <header class="preview-heading">
        <h2>Sprite #{{ spriteIndex }}</h2>
        <p class="dim">{{ entry?.name }}</p>
      </header>
      <p v-if="image.error" class="note">{{ image.error }}</p>
      <template v-else>
        <figure>
          <figcaption>切片预览 <span class="dim">{{ sprite.w }} × {{ sprite.h }}</span></figcaption>
          <p v-if="geometry.error" class="note">{{ geometry.error }}</p>
          <div v-else class="slice-viewport checkerboard">
            <canvas ref="sliceCanvas" role="img" :aria-label="`Sprite ${spriteIndex} 的切片预览`"></canvas>
          </div>
          <p v-if="geometry.layout?.outside" class="warn tiny">切片范围超出贴图，超出部分在静态预览中留空。</p>
        </figure>
        <figure>
          <figcaption>原贴图 <span class="dim">{{ image.texture.width }} × {{ image.texture.height }}</span></figcaption>
          <div class="atlas-viewport">
            <div class="atlas-frame checkerboard">
              <canvas ref="atlasCanvas" role="img" aria-label="原贴图，框线标出当前切片位置"></canvas>
              <div v-if="geometry.layout" class="sprite-outline" :style="outlineStyle" aria-hidden="true"></div>
            </div>
          </div>
        </figure>
      </template>
      <p v-if="drawError" class="note" role="alert">图片预览失败：{{ drawError }}</p>
      <p class="dim tiny">修改左侧参数会立即更新切片和位置框。棋盘格表示透明区域。</p>
    </template>
    <p v-else class="dim">请选择一个 Sprite 查看图片。</p>
  </div>
</template>

<style scoped>
.sprite-preview { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.preview-heading { display: block; padding: 0; border: 0; }
.preview-heading h2 { color: var(--fg); margin: 0 0 4px; }
.preview-heading p { margin: 0; overflow-wrap: anywhere; }
figure { margin: 0; min-width: 0; }
figcaption { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; font-size: 12px; }
.checkerboard { background-color: #454a55; background-image: conic-gradient(#626976 25%, transparent 0 50%, #626976 0 75%, transparent 0);
                background-size: 16px 16px; }
.slice-viewport { display: flex; align-items: center; justify-content: center; min-height: 160px;
                  padding: 16px; border: 1px solid var(--line); border-radius: 6px; }
canvas { display: block; max-width: 100%; height: auto; image-rendering: pixelated; }
.atlas-viewport { max-height: 60vh; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
.atlas-frame { position: relative; width: fit-content; max-width: 100%; overflow: hidden; }
.sprite-outline { position: absolute; border: 2px solid var(--warn); box-shadow: 0 0 0 1px #0008; pointer-events: none; }
</style>
