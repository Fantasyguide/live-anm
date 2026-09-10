import { createApp, ref, computed, shallowRef, onMounted, watch, nextTick } from 'vue';
import { loadAnm, createPlayer, inspect } from './player.js';

const App = {
  setup() {
    const file = shallowRef(null);      // flattenFile 的结果
    const fileName = ref('');
    const error = ref('');
    const dragging = ref(false);
    const canvasEl = ref(null);
    const player = shallowRef(null);
    const playing = ref(false);
    const frame = ref(0);
    const speed = ref(1);
    const selectedScript = ref(0);
    const selectedVm = ref(null);
    const scriptFilter = ref('');
    const viewW = ref(640);
    const viewH = ref(480);
    let raf = 0, acc = 0, last = 0;

    const entries = computed(() => file.value?.entries ?? []);
    const scripts = computed(() => {
      const all = (file.value?.scripts ?? []).map((s, i) => ({
        index: i, id: s.id, entryIndex: s.entryIndex,
        entryName: file.value.entries[s.entryIndex]?.name ?? '?',
        count: s.script.instructions.length,
      }));
      const q = scriptFilter.value.trim().toLowerCase();
      return q ? all.filter((s) => String(s.index) === q || s.entryName.toLowerCase().includes(q)) : all;
    });
    const vms = computed(() => { frame.value; return player.value?.manager.vms ?? []; });
    const skipped = computed(() => { frame.value; return player.value?.manager.skipped ?? []; });
    const errors = computed(() => { frame.value; return player.value?.errors ?? []; });
    const detail = computed(() => (selectedVm.value ? inspect(selectedVm.value) : null));

    async function openFile(f) {
      error.value = '';
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        file.value = loadAnm(bytes);
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
        player.value = createPlayer(canvasEl.value, file.value, { width: viewW.value, height: viewH.value });
        frame.value = 0;
        player.value.render();
      } catch (e) {
        error.value = e.message;
      }
    }

    function spawn() {
      if (!player.value) return;
      try {
        selectedVm.value = player.value.spawn(selectedScript.value);
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
    function reset() { stop(); boot(); }

    watch([viewW, viewH], () => player.value && player.value.resize(viewW.value, viewH.value));

    function onDrop(e) {
      dragging.value = false;
      const f = e.dataTransfer?.files?.[0];
      if (f) openFile(f);
    }

    return {
      file, fileName, error, dragging, canvasEl, playing, frame, speed,
      selectedScript, selectedVm, scriptFilter, viewW, viewH,
      entries, scripts, vms, skipped, errors, detail,
      openFile, spawn, stepOnce, play, stop, reset, onDrop, inspect,
      onPick: (e) => e.target.files[0] && openFile(e.target.files[0]),
      pickVm: (vm) => { selectedVm.value = vm; },
    };
  },
  template: `
  <div class="wrap" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
    <header>
      <h1>live-anm</h1>
      <span class="sub">东方 ANM v8 播放器 · 135/135 opcode · 层 B 部分</span>
      <label class="pick">
        打开 .anm<input type="file" accept=".anm" @change="onPick" hidden>
      </label>
      <span v-if="fileName" class="fname">{{ fileName }}</span>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="!file" class="drop" :class="{ on: dragging }">
      <p><b>把 .anm 文件拖进来</b></p>
      <p class="hint">
        文件只在你的浏览器里解析，<b>不会上传到任何地方</b>。<br>
        本站不含任何游戏数据，请使用你自己安装的游戏里的文件。
      </p>
    </div>

    <div v-else class="grid">
      <section class="col">
        <h2>Script <small>{{ scripts.length }} / {{ file.scripts.length }}</small></h2>
        <input v-model="scriptFilter" placeholder="按序号或 entry 名过滤" class="filter">
        <ul class="list">
          <li v-for="s in scripts" :key="s.index"
              :class="{ sel: s.index === selectedScript }" @click="selectedScript = s.index">
            <b>#{{ s.index }}</b>
            <span class="dim">{{ s.entryName }}</span>
            <span class="dim">{{ s.count }} 条</span>
            <span v-if="s.id !== s.index" class="warn" title="记录里的 id 与全局序号不一致——取脚本一律用序号">id={{ s.id }}</span>
          </li>
        </ul>
      </section>

      <section class="col main">
        <div class="bar">
          <button @click="spawn">建 VM 跑 #{{ selectedScript }}</button>
          <button @click="playing ? stop() : play()" :disabled="!vms.length">{{ playing ? '暂停' : '播放' }}</button>
          <button @click="stepOnce" :disabled="!vms.length">单步</button>
          <button @click="reset">重置</button>
          <span class="dim">帧 {{ frame }} · VM {{ vms.length }}</span>
          <label class="dim">速度 <input type="range" min="0.1" max="3" step="0.1" v-model.number="speed">{{ speed }}×</label>
        </div>
        <canvas ref="canvasEl" class="stage"></canvas>
        <div class="bar">
          <label class="dim">画布 <input type="number" v-model.number="viewW" min="64" max="1920" class="num"> ×
            <input type="number" v-model.number="viewH" min="64" max="1440" class="num"></label>
        </div>

        <div v-if="skipped.length" class="note">
          <b>本帧跳过 {{ skipped.length }} 个 VM</b>（未实现的渲染路径不会崩，但也不静默）：
          <ul><li v-for="(s, i) in skipped.slice(0, 5)" :key="i">
            <span v-if="s.mode !== undefined">mode {{ s.mode }}：</span>{{ s.reason }}
          </li></ul>
        </div>
        <div v-if="errors.length" class="err">
          <b>{{ errors.length }} 处运行时异常</b>
          <ul><li v-for="(e, i) in errors.slice(-3)" :key="i">帧 {{ e.frame }}：{{ e.message }}</li></ul>
        </div>
      </section>

      <section class="col">
        <h2>VM <small>{{ vms.length }}</small></h2>
        <ul class="list">
          <li v-for="(vm, i) in vms" :key="i" :class="{ sel: vm === selectedVm }" @click="pickVm(vm)">
            <b>#{{ i }}</b>
            <span class="dim">layer {{ vm.layer ?? 0 }}</span>
            <span class="dim">pc {{ vm.pc }}</span>
            <span v-if="!vm.alive" class="warn">已终止</span>
          </li>
        </ul>
        <div v-if="detail" class="detail">
          <h3>状态</h3>
          <table>
            <tr v-for="(v, k) in detail" :key="k"><td>{{ k }}</td><td>{{ Array.isArray(v) ? v.join(', ') : v }}</td></tr>
          </table>
        </div>
      </section>
    </div>

    <footer>
      本站不含任何游戏数据 · 代码 MIT · ANM 格式与东方 Project 的一切权利归上海爱丽丝幻乐团 / ZUN 所有
    </footer>
  </div>`,
};

createApp(App).mount('#app');
