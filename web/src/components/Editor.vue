<script setup>
import { computed, ref, watch } from 'vue';
import { assemble } from '@engine/asm.js';

const props = defineProps({ title: String, disabled: Boolean });
const text = defineModel('text', { default: '' });
const emit = defineEmits(['apply']);

const draft = ref(text.value);
watch(text, (v) => { draft.value = v; });
const dirty = computed(() => draft.value !== text.value);
// 边打字边校验——错误逐条带行号，一次全显示（assemble 不抛）
const errors = computed(() => assemble(draft.value).errors);
const lines = computed(() => draft.value.split('\n').length);

function apply() {
  text.value = draft.value;
  emit('apply');
}
</script>

<template>
  <div class="editor">
    <div class="bar">
      <b class="dim">{{ title }}</b>
      <span class="dim tiny">{{ lines }} 行</span>
      <span v-if="errors.length" class="warn tiny">{{ errors.length }} 处错误</span>
      <span v-else-if="dirty" class="dim tiny">已修改</span>
      <span class="spacer"></span>
      <button :disabled="disabled || !!errors.length" @click="apply">应用并预览</button>
    </div>
    <textarea v-model="draft" class="code-edit" spellcheck="false"
              placeholder="时间: 指令名(参数, …);"></textarea>
    <ul v-if="errors.length" class="errlist">
      <li v-for="(e, i) in errors" :key="i"><b>行 {{ e.line }}</b> {{ e.message }}</li>
    </ul>
  </div>
</template>
