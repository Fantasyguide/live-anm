<script setup>
import { computed } from 'vue';
import { lineOfPc } from '@engine/disasm.js';

const props = defineProps({ disasm: Object, vm: Object, frame: Number, scriptIndex: Number });
const emit = defineEmits(['interrupt']);

// frame 进来只为触发重算（vm.pc 是就地改的）
const cur = computed(() => (props.frame, props.vm && props.disasm ? lineOfPc(props.disasm, props.vm.pc) : -1));
</script>

<template>
  <section v-if="disasm" class="disasm">
    <h2>反汇编
      <small v-if="vm">跟随选中的 VM · pc = {{ vm.pc }}</small>
      <small v-else>script #{{ scriptIndex }}（选一个 VM 可跟随执行）</small>
    </h2>

    <!-- 02 §5：`5 case n` 是 interrupt 入口，运行时本身是 no-op，扫描时当标签 -->
    <div v-if="disasm.caseLabels.length" class="bar interrupts">
      <span class="dim">Interrupt：</span>
      <button v-for="l in disasm.caseLabels" :key="l" :disabled="!vm"
              :title="`triggerInterrupt(vm, ${l})` " @click="emit('interrupt', l)">
        {{ l === -1 ? 'default (-1)' : l }}
      </button>
      <span class="dim tiny">投一个中断并推一帧（interrupt 在取指前处理，不推帧看不到效果）</span>
    </div>

    <ol class="code">
      <li v-for="l in disasm.lines" :key="l.index" :class="{ cur: l.index === cur, iscase: l.isCase }">
        <span class="off">{{ l.offset }}</span>
        <span class="t">{{ l.time }}</span>
        <span class="op" :data-g="l.group">{{ l.name }}</span><span class="a">({{ l.args.join(', ') }})</span>
        <span v-if="l.isCase" class="tag">中断入口</span>
      </li>
    </ol>
  </section>
</template>
