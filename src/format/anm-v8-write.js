// 最小的 `.anm` v8 **写入器**——`parseAnm` 的逆运算（单 entry 版）。
//
// 依据：01-format.md §2–§6，逐字段与 `anm-v8.js` 的读法对称。
//
// 用途有两个：
//   1. **浏览器自测**（`web/selftest.html`）需要一个「一定画得出东西」的文件。挑现成的
//      测试夹具不行——它们是为验各自的 opcode 造的，比如 `settings-ops.anm` 只有 1 个
//      sprite 却执行 `300 sprite(3)`，越界，宿主直接跳过不画。自己造才控制得住。
//   2. 将来「在网页上手写 ANM 脚本」要的就是这一步（设计文档 §10.6）。
//
// **只支持单 entry + format 1（A8R8G8B8）**——够上面两个用途，不够的时候再扩，
// 不预先造一个没人用的通用写入器。
const ENTRY_HEADER_SIZE = 0x40;
const INSTR_HEADER_SIZE = 8;
const THTX_HEADER_SIZE = 0x10;

const align4 = (n) => (n + 3) & ~3;

/**
 * @param {{
 *   name?: string, width?: number, height?: number,
 *   sprites: Array<{x:number,y:number,w:number,h:number}>,
 *   scripts: Array<{id?:number, instructions: Array<{time?:number,opcode:number,paramMask?:number,args?:number[]}>}>,
 *   rgba?: Uint8Array,     // width*height*4，RGBA 字节序；不给就是全白不透明
 * }} spec
 * @returns {Uint8Array}
 */
export function buildAnm(spec) {
  const name = spec.name ?? 'synthetic.png';
  const width = spec.width ?? 8;
  const height = spec.height ?? 8;
  const sprites = spec.sprites ?? [];
  const scripts = spec.scripts ?? [];

  const nameBytes = new TextEncoder().encode(name);
  // 01 §10 的实测恒等式：`name_offset == 0x40 + 4*n_sprites + 8*n_scripts`（423/423）
  const nameOffset = ENTRY_HEADER_SIZE + sprites.length * 4 + scripts.length * 8;
  const spriteBase = align4(nameOffset + nameBytes.length + 1); // +1 = 结尾的 NUL

  const scriptSizes = scripts.map(
    (s) => s.instructions.reduce((n, i) => n + INSTR_HEADER_SIZE + (i.args?.length ?? 0) * 4, 0)
      + INSTR_HEADER_SIZE, // 结尾那条 opcode = -1 也占 8 字节（01 §5.1）
  );
  const scriptOffsets = [];
  let cursor = spriteBase + sprites.length * 20;
  for (const size of scriptSizes) { scriptOffsets.push(cursor); cursor += size; }
  const thtxOffset = cursor;
  const pixelBytes = width * height * 4; // format 1，bpp = 4
  const total = thtxOffset + THTX_HEADER_SIZE + pixelBytes;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // ── entry header（01 §3）─────────────────────────────────────────────────────
  view.setUint32(0x00, 8, true);              // version
  view.setUint16(0x04, sprites.length, true);
  view.setUint16(0x06, scripts.length, true);
  view.setUint16(0x0a, width, true);
  view.setUint16(0x0c, height, true);
  view.setUint16(0x0e, 1, true);              // format 1 = A8R8G8B8
  view.setUint32(0x10, nameOffset, true);
  view.setUint32(0x1c, thtxOffset, true);
  view.setUint16(0x20, 1, true);              // has_data
  view.setUint32(0x24, 0, true);              // next_offset = 0 ⇒ 链表结束（单 entry）

  // sprite 偏移表 + script 表
  sprites.forEach((_, i) => view.setUint32(ENTRY_HEADER_SIZE + i * 4, spriteBase + i * 20, true));
  scripts.forEach((s, i) => {
    const at = ENTRY_HEADER_SIZE + sprites.length * 4 + i * 8;
    view.setInt32(at, s.id ?? i, true);       // 01 §5：id 是装饰性的，加载器不读
    view.setUint32(at + 4, scriptOffsets[i], true);
  });

  buf.set(nameBytes, nameOffset);             // 结尾 NUL 由 buf 的零初始化提供

  // ── sprite 记录（01 §4，20 字节）──────────────────────────────────────────────
  sprites.forEach((sp, i) => {
    const at = spriteBase + i * 20;
    view.setUint32(at + 0x00, i, true);       // id 实测恒 = 全局序号
    view.setFloat32(at + 0x04, sp.x, true);
    view.setFloat32(at + 0x08, sp.y, true);
    view.setFloat32(at + 0x0c, sp.w, true);
    view.setFloat32(at + 0x10, sp.h, true);
  });

  // ── 指令流（01 §5.1：s16 opcode / u16 size / s16 time / u16 param_mask + args）──
  scripts.forEach((s, i) => {
    let at = scriptOffsets[i];
    for (const ins of s.instructions) {
      const args = ins.args ?? [];
      const size = INSTR_HEADER_SIZE + args.length * 4;
      view.setInt16(at + 0x00, ins.opcode, true);
      view.setUint16(at + 0x02, size, true);
      view.setInt16(at + 0x04, ins.time ?? 0, true);
      view.setUint16(at + 0x06, ins.paramMask ?? 0, true);
      args.forEach((a, k) => view.setUint32(at + INSTR_HEADER_SIZE + k * 4, a >>> 0, true));
      at += size;
    }
    view.setInt16(at + 0x00, -1, true);       // 结束标记；size 字段实测恒 0
  });

  // ── THTX（01 §6）────────────────────────────────────────────────────────────
  buf.set([0x54, 0x48, 0x54, 0x58], thtxOffset); // "THTX"
  view.setInt16(thtxOffset + 0x06, 1, true);     // format 1
  view.setInt16(thtxOffset + 0x08, width, true);
  view.setInt16(thtxOffset + 0x0a, height, true);
  view.setUint32(thtxOffset + 0x0c, pixelBytes, true);
  // format 1 的字节序是 B,G,R,A（小端 A8R8G8B8）——与 thtx.js 的解码互为逆运算
  const px = thtxOffset + THTX_HEADER_SIZE;
  for (let i = 0; i < width * height; i++) {
    const r = spec.rgba ? spec.rgba[i * 4 + 0] : 255;
    const g = spec.rgba ? spec.rgba[i * 4 + 1] : 255;
    const b = spec.rgba ? spec.rgba[i * 4 + 2] : 255;
    const a = spec.rgba ? spec.rgba[i * 4 + 3] : 255;
    buf[px + i * 4 + 0] = b;
    buf[px + i * 4 + 1] = g;
    buf[px + i * 4 + 2] = r;
    buf[px + i * 4 + 3] = a;
  }
  return buf;
}
