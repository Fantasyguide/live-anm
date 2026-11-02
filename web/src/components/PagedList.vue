<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({ rows: Array, selectedIndex: Number, filter: String, label: String });
const page = ref(1);
const pageSize = ref(20);
const pageCount = computed(() => Math.max(1, Math.ceil(props.rows.length / pageSize.value)));
const start = computed(() => (page.value - 1) * pageSize.value);
const pageRows = computed(() => props.rows.slice(start.value, start.value + pageSize.value));

function setPage(value) {
  const requested = Number(value);
  page.value = Math.min(pageCount.value, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 1));
}

function enterPage(event) {
  setPage(event.target.value);
  event.target.value = page.value;
}

watch(() => props.filter, () => { page.value = 1; });
watch(pageSize, () => { page.value = 1; });
watch(pageCount, () => setPage(page.value));
// Only selection changes reveal its page; editing rows must preserve manual browsing.
watch(() => props.selectedIndex, (selectedIndex) => {
  const position = props.rows.findIndex((row) => row.index === selectedIndex);
  if (position >= 0) page.value = Math.floor(position / pageSize.value) + 1;
}, { immediate: true });
</script>

<template>
  <slot :rows="pageRows" />
  <p v-if="!rows.length" class="dim empty">没有匹配项</p>
  <nav class="pager" :aria-label="`${label} 分页`">
    <span class="range">第 {{ rows.length ? start + 1 : 0 }}–{{ Math.min(start + pageSize, rows.length) }} 项，共 {{ rows.length }} 项</span>
    <label class="size">每页
      <select v-model.number="pageSize">
        <option :value="10">10</option>
        <option :value="20">20</option>
        <option :value="50">50</option>
      </select>
    </label>
    <div class="pages">
      <button :disabled="page <= 1" @click="setPage(page - 1)">上一页</button>
      <label class="page-number">
        <input type="number" :value="page" min="1" :max="pageCount" step="1"
               :aria-label="`${label} 页码`" @change="enterPage" @keydown.enter="enterPage">
        / {{ pageCount }} 页
      </label>
      <button :disabled="page >= pageCount" @click="setPage(page + 1)">下一页</button>
    </div>
  </nav>
</template>

<style scoped>
.empty { margin:6px 0; }
.pager { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; margin:8px 0;
         padding-top:8px; border-top:1px solid var(--line); color:var(--dim); font-size:11px; }
.range { flex-basis:100%; }
.size, .page-number { display:flex; align-items:center; gap:4px; }
.pages { display:flex; flex-wrap:wrap; align-items:center; gap:5px; }
.pager button { padding:3px 6px; font-size:11px; }
.pager input, .pager select { background:var(--panel); border:1px solid var(--line); color:var(--fg);
                             border-radius:5px; padding:3px 4px; font:inherit; }
.pager input { width:48px; }
</style>
