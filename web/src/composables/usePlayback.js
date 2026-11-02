import { computed, ref } from 'vue';

/** 管理播放器的逐帧推进；播放器创建与文件重建由 App 协调。 */
export function usePlayback(player) {
  const playing = ref(false);
  const frame = ref(0);
  const speed = ref(1);
  let raf = 0, acc = 0, last = 0;

  // VM 与错误列表由引擎就地更新，依赖 frame 触发界面刷新。
  const vms = computed(() => (frame.value, player.value?.manager.vms ?? []));
  const skipped = computed(() => (frame.value, player.value?.manager.skipped ?? []));
  const errors = computed(() => (frame.value, player.value?.errors ?? []));

  function stepOnce() {
    if (!player.value) return;
    player.value.step();
    player.value.render();
    frame.value = player.value.frame;
  }

  function loop(t) {
    if (!playing.value) return;
    if (!last) last = t;
    acc += (t - last) * 0.06 * speed.value; last = t;
    let g = 0;
    while (acc >= 1 && g++ < 8) { player.value.step(); acc -= 1; }
    player.value.render(); frame.value = player.value.frame;
    raf = requestAnimationFrame(loop);
  }

  function play() {
    if (!player.value) return;
    playing.value = true;
    last = 0; acc = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    playing.value = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  return { playing, frame, speed, vms, skipped, errors, stepOnce, play, stop };
}
