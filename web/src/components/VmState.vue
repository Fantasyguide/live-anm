<script setup>
import { computed } from 'vue';
import { inspect } from '../player.js';

const props = defineProps({ vm: Object, frame: Number, caseLabels: { type: Array, default: () => [] } });
const emit = defineEmits(['interrupt']);
// frame 进来只为触发重算 —— VM 的字段是被就地改的，Vue 追不到
const d = computed(() => (props.frame, props.vm ? inspect(props.vm) : null));
const FIELDS = [
  ['pc', 'pc'], ['time', 'time'], ['layer', 'layer'], ['spriteId', 'sprite'],
  ['renderMode', 'render'], ['blendMode', 'blend'], ['colorMode', 'color'],
];
</script>

<template>
  <div class="vmstate">
    <template v-if="d">
      <div class="chips">
        <span v-for="[k, label] in FIELDS" :key="k" class="chip"><i>{{ label }}</i>{{ d[k] }}</span>
        <span class="chip" :class="{ dead: !d.alive }"><i>状态</i>{{ d.alive ? '运行中' : '已终止' }}</span>
      </div>
      <div class="chips">
        <span class="chip"><i>pos</i>{{ d.pos.join(', ') }}</span>
        <span class="chip"><i>scale</i>{{ d.scale.join(', ') }}</span>
        <span class="chip"><i>rot</i>{{ d.rotation.join(', ') }}</span>
        <span class="chip"><i>size</i>{{ d.spriteSize.join(', ') }}</span>
        <span class="chip"><i>I</i>{{ d.I.join(', ') }}</span>
        <span class="chip"><i>F</i>{{ d.F.join(', ') }}</span>
      </div>
      <!-- 02 §5：`5 case n` 是 interrupt 入口；投一个之后要推一帧才看得到（取指前处理） -->
      <div v-if="caseLabels.length" class="chips">
        <span class="dim tiny">interrupt</span>
        <button v-for="l in caseLabels" :key="l" class="mini" @click="emit('interrupt', l)">
          {{ l === -1 ? 'default' : l }}
        </button>
      </div>
    </template>
    <span v-else class="dim tiny">建一个 VM 之后，这里显示它的实时状态，下面的代码会跟着高亮当前执行行</span>
  </div>
</template>
