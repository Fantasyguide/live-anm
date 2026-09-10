// 把 format / host / render 三层粘起来的最小播放器。Vue 那层只管 UI，不碰这里的细节。
import { parseAnm } from '@engine/format/anm-v8.js';
import { flattenFile, createManager } from '@engine/host/manager.js';
import { createRenderer, uploadTexture } from '@engine/render/webgl.js';

export function loadAnm(bytes) {
  const parsed = parseAnm(bytes);
  return flattenFile(bytes, parsed);
}

export function createPlayer(canvas, file, opts = {}) {
  // ★ 两个 canvas 参数都不能省（见 src/render/D3D9-MAPPING.md §6）：
  //   premultipliedAlpha: false —— ANM 的 10 种混合都按「非预乘」写，预乘会让半透明整体偏暗
  //   alpha: false             —— blend mode 2/4/6 会把目标 alpha 算成 0，带 alpha 的画布会被打洞
  const gl =
    canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false }) ||
    canvas.getContext('webgl', { alpha: false, premultipliedAlpha: false });
  if (!gl) throw new Error('这个浏览器没有可用的 WebGL 上下文');

  const viewport = { width: opts.width ?? 640, height: opts.height ?? 480 };
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const renderer = createRenderer(gl, { viewport });
  const manager = createManager(file, { gameSpeed: opts.gameSpeed ?? 1 });

  // 贴图按 entry 懒上传
  const texCache = new Map();
  function textureFor(entryIndex) {
    if (texCache.has(entryIndex)) return texCache.get(entryIndex);
    const t = file.textures[entryIndex];
    const handle = t ? uploadTexture(gl, t) : null;
    texCache.set(entryIndex, handle);
    return handle;
  }

  let frame = 0;
  const errors = [];

  function step() {
    try {
      manager.step();
    } catch (err) {
      // 单个 VM 抛异常不该让整个播放器停死——记下来给 UI 显示。
      errors.push({ frame, message: String(err && err.message ? err.message : err) });
    }
    frame++;
  }

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const d of manager.drawList()) {
      const tex = textureFor(d.entryIndex);
      if (!tex) continue;
      try {
        renderer.draw(d.geometry, { vm: d.vm, texture: tex });
      } catch (err) {
        errors.push({ frame, message: String(err.message) });
      }
    }
    renderer.flush();
  }

  return {
    manager,
    get frame() { return frame; },
    get errors() { return errors; },
    spawn: (scriptIndex, spawnOpts) => manager.spawn(scriptIndex, spawnOpts),
    step,
    render,
    reset() {
      manager.vms.length = 0;
      frame = 0;
      errors.length = 0;
    },
    resize(w, h) {
      viewport.width = w; viewport.height = h;
      canvas.width = w; canvas.height = h;
      renderer.setViewport(w, h);
    },
  };
}

/** 把一个 VM 的状态摊成 UI 好显示的形状。 */
export function inspect(vm) {
  const g = vm._general ?? {};
  const f = (v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v);
  return {
    pc: vm.pc,
    time: vm.time,
    alive: vm.alive,
    layer: vm.layer ?? 0,
    spriteId: vm.spriteId ?? null,
    renderMode: (vm.flagsLo >>> 25) & 0x1f,
    blendMode: (vm.flagsLo >>> 5) & 0xf,
    colorMode: (vm.flagsLo >>> 17) & 3,
    anchor: [(vm.flagsLo >>> 21) & 3, (vm.flagsLo >>> 23) & 3],
    flagsLo: '0x' + (vm.flagsLo >>> 0).toString(16).padStart(8, '0'),
    flagsHi: '0x' + (vm.flagsHi >>> 0).toString(16).padStart(8, '0'),
    pos: [f(vm.pos.x), f(vm.pos.y), f(vm.pos.z)],
    scale: [f(vm.scale.x), f(vm.scale.y)],
    rotation: [f(vm.rotation.x), f(vm.rotation.y), f(vm.rotation.z)],
    spriteSize: [f(vm.spriteSize.x), f(vm.spriteSize.y)],
    color1: '#' + (vm.color >>> 0).toString(16).padStart(8, '0'),
    color2: '#' + ((g.color2 ?? 0) >>> 0).toString(16).padStart(8, '0'),
    I: vm.i.map(f),
    F: vm.f.map(f),
  };
}
