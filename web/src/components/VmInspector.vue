<script setup>
import { computed } from 'vue';
import { inspect } from '../player.js';

const props = defineProps({ vms: Array, selected: Object, frame: Number });
const emit = defineEmits(['pick']);
// frame 进来只为触发重算——VM 的字段是被就地改的，Vue 追不到。
const detail = computed(() => (props.frame, props.selected ? inspect(props.selected) : null));
</script>

<template>
  <h2>VM <small>{{ vms.length }}</small></h2>
  <ul class="list">
    <li v-for="(vm, i) in vms" :key="i" :class="{ sel: vm === selected }" @click="emit('pick', vm)">
      <b>#{{ i }}</b>
      <span class="dim">layer {{ vm.layer ?? 0 }}</span>
      <span class="dim">pc {{ vm.pc }}</span>
      <span v-if="!vm.alive" class="warn">已终止</span>
    </li>
  </ul>
  <div v-if="detail" class="detail">
    <h3>状态</h3>
    <table>
      <tr v-for="(v, k) in detail" :key="k">
        <td>{{ k }}</td><td>{{ Array.isArray(v) ? v.join(', ') : v }}</td>
      </tr>
    </table>
  </div>
</template>
