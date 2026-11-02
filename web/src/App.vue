<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue';
import { createPlayer } from './player.js';
import { usePlayback } from './composables/usePlayback.js';
import { VIEWS, toDoc, docToBytes, flatScripts, flatSprites, addScript, addSprite, download, switchView } from './doc.js';
import { captureDraft, readDraft, writeDraft, deleteDraft } from './draft-store.js';
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
import GifExport from './components/GifExport.vue';

const doc = ref(null);
const file = shallowRef(null);
const sourceLines = shallowRef([]);      // [全局 script 序号][指令下标] = 文本行号
const previewTexts = shallowRef([]);     // 最近成功应用的原文，供状态提示和执行行使用
const fileName = ref('');
const unexportedChanges = ref(false);
const recoverableDraft = shallowRef(null);
const draftSavedAt = ref(0);
const draftError = ref('');
let draftTimer = 0;
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
const exportCrop = ref(null);

const scripts = computed(() => (doc.value ? flatScripts(doc.value) : []));
const sprites = computed(() => (doc.value ? flatSprites(doc.value) : []));
const cur = computed(() => scripts.value[selScript.value] ?? null);
// 新建 script 会移动后续 entry 的全局序号；旧预览仍按 entry 和内部序号对应。
const previewScriptIndex = computed(() => !cur.value || !file.value ? -1 : file.value.scripts.findIndex(
  (s) => s.entryIndex === cur.value.entryIndex && s.indexInEntry === cur.value.i,
));
const editorText = computed({
  get: () => (cur.value ? doc.value.entries[cur.value.entryIndex].scriptTexts[cur.value.i] : ''),
  set: (v) => {
    if (!cur.value || v === editorText.value) return;
    doc.value.entries[cur.value.entryIndex].scriptTexts[cur.value.i] = v;
    markEdited();
  },
});

/** 选中的 VM 跑的是哪个全局 script —— 靠指令数组的**引用相同**来认（createVm 存的就是它）。 */
const vmScriptIndex = computed(() => {
  if (!selectedVm.value || !file.value) return -1;
  const rec = file.value.scripts.find((s) => s.script.instructions === selectedVm.value._instructions);
  return rec ? scripts.value.findIndex((s) => s.entryIndex === rec.entryIndex && s.i === rec.indexInEntry) : -1;
});
const vmDisasm = computed(() => (selectedVm.value ? disassemble({ instructions: selectedVm.value._instructions }) : null));
const caseLabels = computed(() => vmDisasm.value?.caseLabels ?? []);

/** 编辑器里该高亮第几行：pc → 指令下标 → 文本行号。 */
const currentLine = computed(() => {
  frame.value;
  const si = vmScriptIndex.value;
  if (si < 0 || si !== selScript.value || !vmDisasm.value) return -1;   // 只在看同一个脚本时高亮
  const pi = previewScriptIndex.value;
  if (editorText.value !== previewTexts.value[pi]) return -1; // 编辑后旧行号已不对应当前原文
  const idx = lineOfPc(vmDisasm.value, selectedVm.value.pc);
  if (idx < 0) return -1;
  return sourceLines.value[pi]?.[idx] ?? -1;
});

async function openFile(f) {
  if (unexportedChanges.value && !window.confirm('当前修改还没有导出。要放弃修改并打开其他文件吗？')) return;
  if (recoverableDraft.value && !window.confirm('还有一份未恢复的本机草稿。要用打开的文件替换它吗？')) return;
  error.value = '';
  try {
    const nextDoc = toDoc(new Uint8Array(await f.arrayBuffer()), syntaxView.value);
    stop();
    player.value = null;
    file.value = null;
    previewTexts.value = [];
    doc.value = nextDoc;
    recoverableDraft.value = null;
    draftSavedAt.value = 0;
    fileName.value = f.name;
    unexportedChanges.value = false;
    selScript.value = 0; selSprite.value = 0; selectedVm.value = null;
    await nextTick();
    rebuild();
    scheduleDraftSave();
  } catch (e) { error.value = `解析失败：${e.message}`; }
}

function rebuild() {
  if (!doc.value) return;
  stop();
  try {
    const { bytes, errors: errs, sourceLines: sl } = docToBytes(doc.value, syntaxView.value);
    buildErrors.value = errs;
    if (errs.length) { error.value = '还有汇编错误，已保留编辑内容和上次预览；修正后再应用'; return; }
    const nextFile = flattenFile(bytes, parseAnm(bytes));
    if (!canvasEl.value) return;
    const nextPlayer = createPlayer(canvasEl.value, nextFile, { width: view.value.w, height: view.value.h });
    file.value = nextFile;
    player.value = nextPlayer;
    sourceLines.value = sl;
    previewTexts.value = scripts.value.map((s) => doc.value.entries[s.entryIndex].scriptTexts[s.i]);
    frame.value = 0;
    selectedVm.value = null;
    player.value.render();
    error.value = '';
  } catch (e) { error.value = `重建失败：${e.message}`; }
}

function spawn() {
  if (!player.value) return;
  if (previewScriptIndex.value < 0) { error.value = '新脚本尚未应用，请先点击「应用并预览」'; return; }
  try {
    selectedVm.value = player.value.spawn(previewScriptIndex.value, { entityPos: { x: spawnAt.value.x, y: spawnAt.value.y, z: 0 } });
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
  // 只转换预览的文本与行号表示，保留正在运行的文件、VM 和播放帧。
  previewTexts.value = file.value?.scripts.map((s) => VIEWS[to].emit(s.script.instructions)) ?? [];
  sourceLines.value = previewTexts.value.map((text) => VIEWS[to].parse(text).sourceLines);
  buildErrors.value = [];
  error.value = '';
  scheduleDraftSave();
}
function exportAnm() {
  if (!doc.value) return;
  try {
    const { bytes, errors: errs } = docToBytes(doc.value, syntaxView.value);
    buildErrors.value = errs;
    if (errs.length) { error.value = `还有 ${errs.length} 处汇编错误，先修掉再导出`; return; }
    download(bytes, fileName.value || 'edited.anm');
    unexportedChanges.value = false;
    error.value = '';
    scheduleDraftSave();
  } catch (e) { error.value = `导出失败：${e.message}`; }
}
function onAddScript() {
  const entryIndex = cur.value?.entryIndex ?? 0;
  addScript(doc.value, entryIndex, syntaxView.value);
  const i = doc.value.entries[entryIndex].scriptTexts.length - 1;
  selScript.value = scripts.value.findIndex((s) => s.entryIndex === entryIndex && s.i === i);
  markEdited();
}
function onAddSprite() {
  addSprite(doc.value, cur.value?.entryIndex ?? 0);
  markEdited();
}
function markEdited() {
  unexportedChanges.value = true;
  scheduleDraftSave();
}
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveCurrentDraft, 500);
}
async function saveCurrentDraft() {
  clearTimeout(draftTimer);
  draftTimer = 0;
  if (!doc.value) return;
  try {
    const snapshot = captureDraft(toRaw(doc.value), fileName.value, syntaxView.value, unexportedChanges.value);
    await writeDraft(snapshot);
    draftSavedAt.value = snapshot.savedAt;
    draftError.value = '';
  } catch (e) { draftError.value = `草稿未能保存到本机：${e.message}。请导出 .anm 保存修改。`; }
}
async function restoreLocalDraft() {
  const saved = recoverableDraft.value;
  if (!saved) return;
  doc.value = saved.doc;
  fileName.value = saved.fileName;
  syntaxView.value = saved.syntaxView;
  unexportedChanges.value = saved.unexportedChanges;
  draftSavedAt.value = saved.savedAt;
  recoverableDraft.value = null;
  selScript.value = 0; selSprite.value = 0; selectedVm.value = null;
  await nextTick();
  rebuild();
}
async function discardLocalDraft() {
  try {
    await deleteDraft();
    recoverableDraft.value = null;
    draftSavedAt.value = 0;
    draftError.value = '';
  } catch (e) { draftError.value = `无法丢弃本机草稿：${e.message}`; }
}
function onBeforeUnload(event) {
  if (draftTimer) saveCurrentDraft();
  if (!unexportedChanges.value) return;
  event.preventDefault();
  event.returnValue = '';
}
function onSaveShortcut(event) {
  if (!doc.value || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  exportAnm();
}
onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('keydown', onSaveShortcut);
  try {
    const saved = await readDraft();
    if (!doc.value) recoverableDraft.value = saved ?? null;
  } catch (e) { draftError.value = `无法读取本机草稿：${e.message}。仍可打开文件并导出。`; }
});
onBeforeUnmount(() => {
  clearTimeout(draftTimer);
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.removeEventListener('keydown', onSaveShortcut);
});
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
      <span v-if="unexportedChanges" class="warn tiny">有修改尚未导出</span>
      <button v-if="doc" @click="exportAnm" title="Ctrl+S / ⌘S">导出 .anm</button>
      <span v-if="draftSavedAt" class="dim tiny">草稿最近保存于 {{ new Date(draftSavedAt).toLocaleTimeString() }}</span>
      <span class="spacer"></span>
      <a class="dim" href="./selftest.html">自测</a>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="draftError" class="err">{{ draftError }}</p>
    <div v-if="recoverableDraft && !doc" class="note bar">
      <span>找到本机草稿：{{ recoverableDraft.fileName }}，{{ new Date(recoverableDraft.savedAt).toLocaleString() }}</span>
      <button @click="restoreLocalDraft">恢复草稿</button>
      <button @click="discardLocalDraft">丢弃草稿</button>
    </div>
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
                    @add="onAddScript" />
        <SpriteList v-else v-model="selSprite" :sprites="sprites"
                    @add="onAddSprite" @change="markEdited" @apply="rebuild" />
      </section>

      <!-- 中：VM 状态 + 代码（主导区） -->
      <section class="col center">
        <VmState :vm="selectedVm" :frame="frame" :case-labels="caseLabels" @interrupt="onInterrupt" />
        <CodePane v-model:text="editorText" :disabled="!cur" :current-line="currentLine" :view="syntaxView"
                  :applied-text="previewTexts[previewScriptIndex] ?? ''"
                  @switch-view="onSwitchView"
                  :title="cur ? `script #${selScript} · ${cur.entryName}` : '（未选中）'"
                  @apply="rebuild" />
      </section>

      <!-- 右：预览 + VM 列表 -->
      <section class="col side">
        <Stage v-model:view="view" v-model:spawnAt="spawnAt" v-model:speed="speed" v-model:canvasEl="canvasEl"
               :playing="playing" :frame="frame" :vm-count="vms.length" :skipped="skipped" :errors="errors" :crop="exportCrop"
               @spawn="spawn" @toggle="playing ? stop() : play()" @step="stepOnce" @reset="rebuild"
               @center="spawnAt = { x: Math.round(view.w / 2), y: Math.round(view.h / 2) }" />
        <GifExport :file="file" :script-index="previewScriptIndex" :file-name="fileName" :view="view" :spawn-at="spawnAt"
                   @crop-change="exportCrop = $event" />
        <VmInspector :vms="vms" :selected="selectedVm" :frame="frame" @pick="(vm) => (selectedVm = vm)" />
      </section>
    </div>

    <footer>
      本站不含任何游戏数据 · 代码 MIT · ANM 格式与东方 Project 的一切权利归上海爱丽丝幻乐团 / ZUN 所有
    </footer>
  </div>
</template>
