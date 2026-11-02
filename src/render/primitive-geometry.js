// TH16 无贴图图元；一手函数与完整契约见 docs/anm-primitives.md。
import { getParentVm } from '../vm/group-child.js';
import { ensureGeneralState } from '../vm/group-general.js';

export function isPrimitiveMode(mode) {
  return [16, 17, 18, 19, 20, 21, 22, 26, 27].includes(mode);
}

const f32 = Math.fround;
const TAU = f32(2 * Math.PI), PI = f32(Math.PI);

function wrapAngle(angle) {
  let n = 0;
  while (angle > PI) { angle = f32(angle - TAU); if (n++ > 0x20) break; }
  while (angle < -PI) { angle = f32(angle + TAU); if (n++ > 0x20) break; }
  return angle;
}

function vertex(x, y, color) {
  return { x, y, z: 0, color: color >>> 0, u: 0, v: 0 };
}

// 0x468722 / 0x4689b3：直接父 scale，不读 scale2；分辨率只处理 mode 1/2。
function dimensions(vm, ratio) {
  let width = f32(vm.spriteSize.x * vm.scale.x);
  let height = f32(vm.spriteSize.y * vm.scale.y);
  let angle = vm.rotation.z;
  const parent = getParentVm(vm);
  if (parent && !(vm.flagsHi & 0x10000)) {
    width = f32(width * parent.scale.x);
    height = f32(height * parent.scale.y);
    angle = f32(angle + parent.rotation.z);
  }
  const resolution = vm.flagsHi & 0x700000;
  if (resolution === 0x100000 || resolution === 0x200000) {
    const factor = resolution === 0x100000 ? ratio : f32(ratio * 0.5);
    width = f32(width * factor); height = f32(height * factor);
  }
  return { width, height, angle };
}

function bounds(size, anchor, fallback) {
  if (anchor === 0) return [f32(-size * 0.5), f32(size * 0.5)];
  if (anchor === 1) return [0, size];
  if (anchor === 2) return [-size, 0];
  // 原函数的非法 anchor=3 分支将横向两端设为 height、纵向两端设为 height。
  return [fallback, fallback];
}

function rectangle(vm, position, width, height, angle, c1, c2) {
  const [left, right] = bounds(width, (vm.flagsLo >>> 21) & 3, height);
  const [top, bottom] = bounds(height, (vm.flagsLo >>> 23) & 3, height);
  const c = f32(Math.cos(angle)), s = f32(Math.sin(angle));
  return [[left, top, c1], [right, top, c2], [left, bottom, c1], [right, bottom, c2]]
    .map(([x, y, color]) => vertex(
      f32(f32(f32(x * c) - f32(y * s)) + position.x),
      f32(f32(f32(x * s) + f32(y * c)) + position.y), color));
}

/** position 由 geometry.js 的 finalPos 计算，保留与尺寸不同的分辨率规则。 */
export function buildPrimitiveGeometry(vm, position, ratio = 1) {
  const mode = (vm.flagsLo >>> 25) & 0x1f;
  const { width, height, angle } = dimensions(vm, ratio);
  const c1 = vm.color >>> 0, c2 = ensureGeneralState(vm).color2 >>> 0;
  const result = (primitive, vertices) => ({ mode, space: 'screen', textured: false, primitive, vertices });
  if ([16, 20, 21, 22, 26, 27].includes(mode)) {
    const endColor = (vm.flagsLo & 0x60000) ? c2 : c1;
    if (mode === 26) {
      const [left, right] = bounds(width, (vm.flagsLo >>> 21) & 3, angle);
      const c = f32(Math.cos(angle)), s = f32(Math.sin(angle));
      return result('lines', [left, right].map((x, i) => vertex(
        f32(f32(x * c) + position.x), f32(f32(x * s) + position.y), i ? endColor : c1)));
    }
    if (mode === 27) {
      const q = rectangle(vm, position, width, height, angle, c1, endColor);
      return result('linestrip', [q[0], q[1], q[3], q[2], q[0]]);
    }
    const rightColor = mode === 20 || mode === 22 ? c2 : c1;
    const q = rectangle(vm, position, width, height, angle, c1, rightColor);
    if (mode === 21 || mode === 22) {
      const halfAlpha = c => ((c & 0xffffff) | ((c >>> 1) & 0x7f000000)) >>> 0;
      const shadow = rectangle(vm, position, f32(width + 1), f32(height + 1), angle, halfAlpha(c1), halfAlpha(rightColor));
      return result('triangles', [shadow, q].flatMap(v => [v[0], v[1], v[2], v[1], v[3], v[2]]));
    }
    return result('quad', q);
  }

  // 0x469640 / 0x469a00 / 0x469bd0：n+1 次计算闭合端点，先发点再更新角。
  const primitive = mode === 17 ? 'trianglefan' : mode === 18 ? 'linestrip' : 'trianglestrip';
  const vertices = [];
  const count = vm.i[0] | 0;
  // 原版会向 D3D 传无效图元数；播放器用空几何处理非正边数。
  if (count <= 0) return result(primitive, vertices);
  if (mode === 17) vertices.push(vertex(position.x, position.y, c1));
  const delta = f32(TAU / count);
  const half = f32(height * 0.5);
  let theta = angle;
  const point = (radius, color) => vertex(
    f32(f32(Math.cos(theta) * radius) + position.x),
    f32(f32(Math.sin(theta) * radius) + position.y), color);
  for (let i = 0; i <= count; i++) {
    if (mode === 19) {
      vertices.push(point(f32(width - half), c1), point(f32(width + half), c1));
    } else vertices.push(point(width, mode === 17 ? c2 : c1));
    theta = wrapAngle(f32(theta + delta));
  }
  return result(primitive, vertices);
}
