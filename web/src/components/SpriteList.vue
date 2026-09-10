<script setup>
defineProps({ sprites: Array, modelValue: Number });
const emit = defineEmits(['update:modelValue', 'add', 'change']);
</script>

<template>
  <h2>Sprite <small>{{ sprites.length }}</small>
    <button class="mini" @click="emit('add')">+ 新建</button>
  </h2>
  <ul class="list">
    <li v-for="(s, i) in sprites" :key="i" :class="{ sel: i === modelValue }"
        @click="emit('update:modelValue', i)">
      <b>#{{ i }}</b>
      <span class="dim">{{ s.entryName }}</span>
      <span class="dim">{{ s.sprite.w }}×{{ s.sprite.h }}</span>
    </li>
  </ul>
  <div v-if="sprites[modelValue]" class="detail">
    <h3>编辑 sprite #{{ modelValue }}</h3>
    <div class="grid2">
      <label>x<input type="number" v-model.number="sprites[modelValue].sprite.x" @change="emit('change')" class="num"></label>
      <label>y<input type="number" v-model.number="sprites[modelValue].sprite.y" @change="emit('change')" class="num"></label>
      <label>w<input type="number" v-model.number="sprites[modelValue].sprite.w" @change="emit('change')" class="num"></label>
      <label>h<input type="number" v-model.number="sprites[modelValue].sprite.h" @change="emit('change')" class="num"></label>
    </div>
    <p class="dim tiny">改完点上方「应用并预览」重建文件</p>
  </div>
</template>
