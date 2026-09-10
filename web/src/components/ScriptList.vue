<script setup>
import { computed, ref } from 'vue';

const props = defineProps({ scripts: Array, entries: Array, modelValue: Number });
const emit = defineEmits(['update:modelValue', 'add']);
const filter = ref('');

const rows = computed(() => {
  const all = props.scripts.map((s, i) => ({
    index: i,
    id: s.id,
    entryName: s.entryName ?? '?',
  }));
  const q = filter.value.trim().toLowerCase();
  return q ? all.filter((s) => String(s.index) === q || s.entryName.toLowerCase().includes(q)) : all;
});
</script>

<template>
  <h2>Script <small>{{ rows.length }} / {{ scripts.length }}</small>
    <button class="mini" @click="emit('add')">+ 新建</button>
  </h2>
  <input v-model="filter" class="filter" placeholder="按序号或 entry 名过滤">
  <ul class="list">
    <li v-for="s in rows" :key="s.index" :class="{ sel: s.index === modelValue }"
        @click="emit('update:modelValue', s.index)">
      <b>#{{ s.index }}</b>
      <span class="dim">{{ s.entryName }}</span>
      <!-- 01 §5：script 的 id 是装饰性的，取脚本一律用跨 entry 的运行序号 -->
      <span v-if="s.id !== s.index" class="warn" title="记录里的 id 与全局序号不一致——取脚本一律用序号">
        id={{ s.id }}
      </span>
    </li>
  </ul>
</template>
