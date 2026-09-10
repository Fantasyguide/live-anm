<script setup>
const props = defineProps({
  playing: Boolean, frame: Number, vmCount: Number, skipped: Array, errors: Array, canSpawn: Boolean,
});
const emit = defineEmits(['spawn', 'toggle', 'step', 'reset', 'resize', 'center']);
const view = defineModel('view', { default: { w: 640, h: 480 } });
const spawnAt = defineModel('spawnAt', { default: { x: 320, y: 240 } });
const speed = defineModel('speed', { default: 1 });
const canvasEl = defineModel('canvasEl', { default: null });
</script>

<template>
  <div class="bar">
    <button @click="emit('spawn')">建 VM</button>
    <button @click="emit('toggle')" :disabled="!vmCount">{{ playing ? '暂停' : '播放' }}</button>
    <button @click="emit('step')" :disabled="!vmCount">单步</button>
    <button @click="emit('reset')">重置</button>
    <span class="dim">帧 {{ frame }} · VM {{ vmCount }}</span>
    <label class="dim">速度 <input type="range" min="0.1" max="3" step="0.1" v-model.number="speed">{{ speed }}×</label>
  </div>

  <canvas :ref="(el) => (canvasEl = el)" class="stage"></canvas>

  <div class="bar">
    <label class="dim">画布
      <input type="number" v-model.number="view.w" min="64" max="1920" class="num"> ×
      <input type="number" v-model.number="view.h" min="64" max="1440" class="num"></label>
    <!-- entity_pos（+0x5e0）：真机由宿主（敌人/子弹/自机）写进 VM 的实体坐标。
         脚本自己只管相对动画，所以「摆在哪」要在这里给。02 §3.3：wipe 保留这块不清。 -->
    <label class="dim" title="entity_pos —— 宿主实体坐标。脚本自己不决定绝对位置。">
      位置 <input type="number" v-model.number="spawnAt.x" class="num"> ,
      <input type="number" v-model.number="spawnAt.y" class="num"></label>
    <button @click="emit('center')">居中</button>
    <span class="dim tiny">（新建 VM 时生效）</span>
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
</template>
