<script setup>
import { computed, ref } from 'vue';
import PagedList from './PagedList.vue';

const props = defineProps({ sprites: Array, modelValue: Number });
const emit = defineEmits(['update:modelValue', 'add', 'change', 'apply']);
const filter = ref('');
const rows = computed(() => {
  const all = props.sprites.map((s, index) => ({ index, entryName: s.entryName, sprite: s.sprite }));
  const q = filter.value.trim().toLowerCase();
  return q ? all.filter((s) => String(s.index) === q || (s.entryName ?? '').toLowerCase().includes(q)) : all;
});
</script>

<template>
  <h2>Sprite <small>{{ rows.length }} / {{ sprites.length }}</small>
    <button class="mini" @click="emit('add')">+ 新建</button>
  </h2>
  <input v-model="filter" class="filter" placeholder="按序号或 entry 名过滤">
  <PagedList :rows="rows" :selected-index="modelValue" :filter="filter" label="Sprite" v-slot="{ rows: pageRows }">
    <ul class="list">
      <li v-for="s in pageRows" :key="s.index" :class="{ sel: s.index === modelValue }"
          @click="emit('update:modelValue', s.index)">
        <b>#{{ s.index }}</b>
        <span class="dim">{{ s.entryName }}</span>
        <span class="dim">{{ s.sprite.w }}×{{ s.sprite.h }}</span>
      </li>
    </ul>
  </PagedList>
  <div v-if="sprites[modelValue]" class="detail">
    <h3>编辑 sprite #{{ modelValue }}</h3>
    <div class="grid2">
      <label>x<input type="number" v-model.number="sprites[modelValue].sprite.x" @input="emit('change')" class="num"></label>
      <label>y<input type="number" v-model.number="sprites[modelValue].sprite.y" @input="emit('change')" class="num"></label>
      <label>w<input type="number" v-model.number="sprites[modelValue].sprite.w" @input="emit('change')" class="num"></label>
      <label>h<input type="number" v-model.number="sprites[modelValue].sprite.h" @input="emit('change')" class="num"></label>
    </div>
    <button @click="emit('apply')">应用到动画预览</button>
    <p class="dim tiny">静态图片即时更新。应用会重置动画预览，之后需重新建 VM 播放引用此切片的脚本。</p>
  </div>
</template>
