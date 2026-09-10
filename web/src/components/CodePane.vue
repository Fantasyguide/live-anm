<script setup>
import { computed, ref, watch } from 'vue';
import { VIEWS } from '../doc.js';

const props = defineProps({
  title: String,
  disabled: Boolean,
  currentLine: { type: Number, default: -1 },   // 1 起；-1 = 没在执行
  view: { type: String, default: 'raw' },       // 'raw' | 'thanm'
});
const text = defineModel('text', { default: '' });
const emit = defineEmits(['apply', 'switch-view']);

const draft = ref(text.value);
watch(text, (v) => { draft.value = v; });
const dirty = computed(() => draft.value !== text.value);
// 边打字边校验：assemble 不抛，错误逐条带行号，一次全显示
const errors = computed(() => VIEWS[props.view].parse(draft.value).errors);
const errorLines = computed(() => new Set(errors.value.map((e) => e.line)));
const lines = computed(() => draft.value.split('\n'));

const auto = ref(false);
let timer = 0;
function apply() { text.value = draft.value; emit('apply'); }
// 自动应用：停手 500ms 且没有错误才重建，免得每敲一个字符就重跑一遍
watch([draft, auto], () => {
  clearTimeout(timer);
  if (!auto.value || props.disabled) return;
  timer = setTimeout(() => { if (!errors.value.length && dirty.value) apply(); }, 500);
});
</script>

<template>
  <div class="pane">
    <div class="bar">
      <b>{{ title }}</b>
      <span class="dim tiny">{{ lines.length }} 行</span>
      <span v-if="errors.length" class="warn tiny">{{ errors.length }} 处错误</span>
      <span v-else-if="dirty" class="warn tiny">已修改（预览还是上次应用的版本）</span>
      <span class="spacer"></span>
      <!-- 原始视图贴着机器（时间在每条指令上、跳转是原始字节偏移）；
           thanm 视图贴着人（时间标签行 + 跳转标签 + sprite/script 名）。两边产出同一份指令。 -->
      <span class="seg">
        <button :class="{ on: view === 'raw' }" @click="emit('switch-view', 'raw')" title="贴着机器：时间写在每条指令上，跳转是原始字节偏移">原始</button>
        <button :class="{ on: view === 'thanm' }" @click="emit('switch-view', 'thanm')" title="贴着人：时间标签行 + 跳转标签 + sprite/script 名（thanm 语法）">thanm</button>
      </span>
      <label class="dim tiny"><input type="checkbox" v-model="auto"> 自动应用</label>
      <button :disabled="disabled || !!errors.length || !dirty" @click="apply">应用并预览</button>
    </div>

    <!-- 高亮层与 textarea 用**同一套字体度量**叠在一起：行高/字号/内边距必须一致，
         否则高亮条会和文字错位。textarea 自身不滚动（高度跟着行数长），由外层滚。 -->
    <div class="code-wrap">
      <div class="hl-layer" aria-hidden="true">
        <div v-for="(l, i) in lines" :key="i" class="hl-row"
             :class="{ cur: i + 1 === currentLine, bad: errorLines.has(i + 1) }">
          <span class="ln">{{ i + 1 }}</span>
        </div>
      </div>
      <textarea v-model="draft" class="code-edit" spellcheck="false" wrap="off"
                :style="{ height: lines.length * 21 + 16 + 'px' }"
                placeholder="时间: 指令名(参数, …);"></textarea>
    </div>

    <ul v-if="errors.length" class="errlist">
      <li v-for="(e, i) in errors" :key="i"><b>行 {{ e.line }}</b> {{ e.message }}</li>
    </ul>
  </div>
</template>
