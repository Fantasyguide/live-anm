<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { loadAnm, createPlayer } from './player.js';
import { disassemble } from '@engine/disasm.js';
import { triggerInterrupt } from '@engine/vm/core.js';
import ScriptList from './components/ScriptList.vue';
import Stage from './components/Stage.vue';
import Disasm from './components/Disasm.vue';
import VmInspector from './components/VmInspector.vue';

const file = shallowRef(null);
const fileName = ref('');
const error = ref('');
const dragging = ref(false);
const player = shallowRef(null);
const canvasEl = ref(null);
const playing = ref(false);
const frame = ref(0);
const speed = ref(1);
const view = ref({ w: 640, h: 480 });
// entity_pos —— 「摆在哪」。默认画布正中：(0,0) 是左上角，多数脚本会有一半在画外。
const spawnAt = ref({ x: 320, y: 240 });
const selectedScript = ref(0);
const selectedVm = shallowRef(null);
let raf = 0, acc = 0, last = 0;

const vms = computed(() => (frame.value, player.value?.manager.vms ?? []));
const skipped = computed(() => (frame.value, player.value?.manager.skipped ?? []));
const errors = computed(() => (frame.value, player.value?.errors ?? []));
const disasm = computed(() => {
  const src = selectedVm.value
    ? { instructions: selectedVm.value._instructions }
    : file.value?.scripts[selectedScript.value]?.script;
  return src ? disassemble(src) : null;
});

async function openFile(f) {
  error.value = '';
  try {
    file.value = loadAnm(new Uint8Array(await f.arrayBuffer()));
    fileName.value = f.name;
    selectedScript.value = 0;
    selectedVm.value = null;
    await nextTick();
    boot();
  } catch (e) {
    error.value = `解析失败：${e.message}`;
    file.value = null;
  }
}

function boot() {
  stop();
  if (!file.value || !canvasEl.value) return;
  try {
    player.value = createPlayer(canvasEl.value, file.value, { width: view.value.w, height: view.value.h });
    frame.value = 0;
    player.value.render();
  } catch (e) { error.value = e.message; }
}

function spawn() {
  if (!player.value) return;
  try {
    selectedVm.value = player.value.spawn(selectedScript.value, {
      entityPos: { x: spawnAt.value.x, y: spawnAt.value.y, z: 0 },
    });
    frame.value = player.value.frame;
    player.value.render();
  } catch (e) { error.value = e.message; }
}
function stepOnce() {
  if (!player.value) return;
  player.value.step();
  player.value.render();
  frame.value = player.value.frame;
}
function loop(t) {
  if (!playing.value) return;
  if (!last) last = t;
  acc += (t - last) * 0.06 * speed.value; // 60fps 基准
  last = t;
  let guard = 0;
  while (acc >= 1 && guard++ < 8) { player.value.step(); acc -= 1; }
  player.value.render();
  frame.value = player.value.frame;
  raf = requestAnimationFrame(loop);
}
function play() { if (!player.value) return; playing.value = true; last = 0; acc = 0; raf = requestAnimationFrame(loop); }
function stop() { playing.value = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
function onInterrupt(label) {
  if (!selectedVm.value) return;
  triggerInterrupt(selectedVm.value, label); // 02 §5：取指前处理，所以要推一帧才看得到
  stepOnce();
}

watch(view, (v) => player.value?.resize(v.w, v.h), { deep: true });
</script>

<template>
  <div class="wrap" @dragover.prevent="dragging = true" @dragleave="dragging = false"
       @drop.prevent="dragging = false; $event.dataTransfer.files[0] && openFile($event.dataTransfer.files[0])">
    <header>
      <h1>live-anm</h1>
      <span class="sub">东方 ANM v8 播放器 · 135/135 opcode · 层 B 部分</span>
      <label class="pick">打开 .anm
        <input type="file" accept=".anm" hidden @change="$event.target.files[0] && openFile($event.target.files[0])">
      </label>
      <span v-if="fileName" class="fname">{{ fileName }}</span>
      <a class="dim" href="./selftest.html">自测</a>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="!file" class="drop" :class="{ on: dragging }">
      <p><b>把 .anm 文件拖进来</b></p>
      <p class="hint">
        文件只在你的浏览器里解析，<b>不会上传到任何地方</b>。<br>
        本站不含任何游戏数据，请使用你自己安装的游戏里的文件。
      </p>
    </div>

    <template v-else>
      <div class="grid">
        <section class="col">
          <ScriptList v-model="selectedScript" :scripts="file.scripts" :entries="file.entries" />
        </section>
        <section class="col main">
          <Stage v-model:view="view" v-model:spawnAt="spawnAt" v-model:speed="speed" v-model:canvasEl="canvasEl"
                 :playing="playing" :frame="frame" :vm-count="vms.length" :skipped="skipped" :errors="errors"
                 @spawn="spawn" @toggle="playing ? stop() : play()" @step="stepOnce" @reset="boot"
                 @center="spawnAt = { x: Math.round(view.w / 2), y: Math.round(view.h / 2) }" />
        </section>
        <section class="col">
          <VmInspector :vms="vms" :selected="selectedVm" :frame="frame" @pick="(vm) => (selectedVm = vm)" />
        </section>
      </div>
      <Disasm :disasm="disasm" :vm="selectedVm" :frame="frame" :script-index="selectedScript"
              @interrupt="onInterrupt" />
    </template>

    <footer>
      本站不含任何游戏数据 · 代码 MIT · ANM 格式与东方 Project 的一切权利归上海爱丽丝幻乐团 / ZUN 所有
    </footer>
  </div>
</template>
