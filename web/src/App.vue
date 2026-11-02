<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { createPlayer } from './player.js';
import { usePlayback } from './composables/usePlayback.js';
import { toDoc, docToBytes, flatScripts, flatSprites, addScript, addSprite, download, switchView } from './doc.js';
import { flattenFile } from '@engine/host/manager.js';
import { parseAnm } from '@engine/format/anm-v8.js';
import { disassemble, lineOfPc } from '@engine/disasm.js';
import { triggerInterrupt } from '@engine/vm/core.js';
import ScriptList from './components/ScriptList.vue';
import SpriteList from './components/SpriteList.vue';
import Stage from './components/Stage.vue';
import CodePane from './components/CodePane.vue';
import VmState from './components/VmState.vue';
import VmInspector from './components/VmInspector.vue';

const doc = ref(null);
const file = shallowRef(null);
const sourceLines = shallowRef([]);      // [全局 script 序号][指令下标] = 文本行号
const fileName = ref('');
const error = ref('');
const buildErrors = ref([]);
const dragging = ref(false);
const player = shallowRef(null);
const canvasEl = ref(null);
const { playing, frame, speed, vms, skipped, errors, stepOnce, play, stop } = usePlayback(player);
const view = ref({ w: 640, h: 480 });
const spawnAt = ref({ x: 320, y: 240 });
const tab = ref('script');
const syntaxView = ref('thanm');   // 默认给语法糖视图——手写脚本时它几乎是必需的
const selScript = ref(0);
const selSprite = ref(0);
const selectedVm = shallowRef(null);

const scripts = computed(() => (doc.value ? flatScripts(doc.value) : []));
const sprites = computed(() => (doc.value ? flatSprites(doc.value) : []));
const cur = computed(() => scripts.value[selScript.value] ?? null);
const editorText = computed({
  get: () => (cur.value ? doc.value.entries[cur.value.entryIndex].scriptTexts[cur.value.i] : ''),
  set: (v) => { if (cur.value) doc.value.entries[cur.value.entryIndex].scriptTexts[cur.value.i] = v; },
});

/** 选中的 VM 跑的是哪个全局 script —— 靠指令数组的**引用相同**来认（createVm 存的就是它）。 */
const vmScriptIndex = computed(() => {
  if (!selectedVm.value || !file.value) return -1;
  return file.value.scripts.findIndex((s) => s.script.instructions === selectedVm.value._instructions);
});
const vmDisasm = computed(() => (selectedVm.value ? disassemble({ instructions: selectedVm.value._instructions }) : null));
const caseLabels = computed(() => vmDisasm.value?.caseLabels ?? []);

/** 编辑器里该高亮第几行：pc → 指令下标 → 文本行号。 */
const currentLine = computed(() => {
  frame.value;
  const si = vmScriptIndex.value;
  if (si < 0 || si !== selScript.value || !vmDisasm.value) return -1;   // 只在看同一个脚本时高亮
  const idx = lineOfPc(vmDisasm.value, selectedVm.value.pc);
  if (idx < 0) return -1;
  return sourceLines.value[si]?.[idx] ?? -1;
});

async function openFile(f) {
  error.value = '';
  try {
    doc.value = toDoc(new Uint8Array(await f.arrayBuffer()), syntaxView.value);
    fileName.value = f.name;
    selScript.value = 0; selSprite.value = 0; selectedVm.value = null;
    await nextTick();
    rebuild();
  } catch (e) { error.value = `解析失败：${e.message}`; doc.value = null; }
}

function rebuild() {
  if (!doc.value) return;
  stop();
  try {
    const { bytes, errors: errs, sourceLines: sl } = docToBytes(doc.value, syntaxView.value);
    buildErrors.value = errs;
    sourceLines.value = sl;
    file.value = flattenFile(bytes, parseAnm(bytes));
    if (!canvasEl.value) return;
    player.value = createPlayer(canvasEl.value, file.value, { width: view.value.w, height: view.value.h });
    frame.value = 0;
    selectedVm.value = null;
    player.value.render();
    error.value = '';
  } catch (e) { error.value = `重建失败：${e.message}`; }
}

function spawn() {
  if (!player.value) return;
  try {
    selectedVm.value = player.value.spawn(selScript.value, { entityPos: { x: spawnAt.value.x, y: spawnAt.value.y, z: 0 } });
    frame.value = player.value.frame;
    player.value.render();
  } catch (e) { error.value = e.message; }
}
function onInterrupt(l) { if (!selectedVm.value) return; triggerInterrupt(selectedVm.value, l); stepOnce(); }
function onSwitchView(to) {
  if (to === syntaxView.value || !doc.value) return;
  const r = switchView(doc.value, syntaxView.value, to);
  if (!r.ok) { buildErrors.value = r.errors; error.value = '还有汇编错误，修掉才能换视图（否则会丢掉写坏的那几行）'; return; }
  syntaxView.value = to;
  buildErrors.value = [];
  error.value = '';
  rebuild();
}
function exportAnm() {
  const { bytes, errors: errs } = docToBytes(doc.value, syntaxView.value);
  buildErrors.value = errs;
  if (errs.length) { error.value = `还有 ${errs.length} 处汇编错误，先修掉再导出`; return; }
  download(bytes, fileName.value || 'edited.anm');
}
// 选中 VM 时自动切到它跑的那个脚本，不然高亮无处可显
watch(selectedVm, () => { if (vmScriptIndex.value >= 0) selScript.value = vmScriptIndex.value; });
watch(view, (v) => player.value?.resize(v.w, v.h), { deep: true });
</script>

<template>
  <div class="wrap" @dragover.prevent="dragging = true" @dragleave="dragging = false"
       @drop.prevent="dragging = false; $event.dataTransfer.files[0] && openFile($event.dataTransfer.files[0])">
    <header>
      <h1>live-anm</h1>
      <span class="sub">东方 ANM v8 播放器 / 编辑器</span>
      <label class="pick">打开 .anm
        <input type="file" accept=".anm" hidden @change="$event.target.files[0] && openFile($event.target.files[0])">
      </label>
      <span v-if="fileName" class="fname">{{ fileName }}</span>
      <button v-if="doc" @click="exportAnm">导出 .anm</button>
      <span class="spacer"></span>
      <a class="dim" href="./selftest.html">自测</a>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <div v-if="buildErrors.length" class="err">
      <b>{{ buildErrors.length }} 处汇编错误</b>
      <ul><li v-for="(e, i) in buildErrors.slice(0, 6)" :key="i">
        {{ e.entryName }} · script {{ e.scriptIndex }} · 行 {{ e.line }}：{{ e.message }}
      </li></ul>
    </div>

    <div v-if="!doc" class="drop" :class="{ on: dragging }">
      <p><b>把 .anm 文件拖进来</b></p>
      <p class="hint">
        文件只在你的浏览器里解析与重建，<b>不会上传到任何地方</b>。<br>
        本站不含任何游戏数据，请使用你自己安装的游戏里的文件。
      </p>
    </div>

    <div v-else class="grid">
      <!-- 左：表 -->
      <section class="col side">
        <div class="tabs">
          <button :class="{ on: tab === 'script' }" @click="tab = 'script'">Script</button>
          <button :class="{ on: tab === 'sprite' }" @click="tab = 'sprite'">Sprite</button>
        </div>
        <ScriptList v-if="tab === 'script'" v-model="selScript" :scripts="scripts" :entries="doc.entries"
                    @add="addScript(doc, cur?.entryIndex ?? 0, syntaxView); rebuild()" />
        <SpriteList v-else v-model="selSprite" :sprites="sprites"
                    @add="addSprite(doc, cur?.entryIndex ?? 0)" @change="() => {}" />
      </section>

      <!-- 中：VM 状态 + 代码（主导区） -->
      <section class="col center">
        <VmState :vm="selectedVm" :frame="frame" :case-labels="caseLabels" @interrupt="onInterrupt" />
        <CodePane v-model:text="editorText" :disabled="!cur" :current-line="currentLine" :view="syntaxView"
                  @switch-view="onSwitchView"
                  :title="cur ? `script #${selScript} · ${cur.entryName}` : '（未选中）'"
                  @apply="rebuild" />
      </section>

      <!-- 右：预览 + VM 列表 -->
      <section class="col side">
        <Stage v-model:view="view" v-model:spawnAt="spawnAt" v-model:speed="speed" v-model:canvasEl="canvasEl"
               :playing="playing" :frame="frame" :vm-count="vms.length" :skipped="skipped" :errors="errors"
               @spawn="spawn" @toggle="playing ? stop() : play()" @step="stepOnce" @reset="rebuild"
               @center="spawnAt = { x: Math.round(view.w / 2), y: Math.round(view.h / 2) }" />
        <VmInspector :vms="vms" :selected="selectedVm" :frame="frame" @pick="(vm) => (selectedVm = vm)" />
      </section>
    </div>

    <footer>
      本站不含任何游戏数据 · 代码 MIT · ANM 格式与东方 Project 的一切权利归上海爱丽丝幻乐团 / ZUN 所有
    </footer>
  </div>
</template>
