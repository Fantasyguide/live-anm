// `.anm` v8 写入器测试：**往返**（buildAnm → parseAnm）是主要判据——
// 写入器唯一有意义的正确性标准就是「我们自己的解析器读回来一模一样」，
// 而那个解析器是对着 thanm 差分验过的（format.test.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnm } from '../src/format/anm-v8-write.js';
import { parseAnm } from '../src/format/anm-v8.js';
import { decodeThtx } from '../src/format/thtx.js';

const SPEC = {
  name: 'roundtrip.png',
  width: 4,
  height: 2,
  sprites: [{ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }],
  scripts: [
    { id: -7, instructions: [
      { time: 0, opcode: 300, paramMask: 0, args: [1] },
      { time: 5, opcode: 400, paramMask: 0x2, args: [1, 10004, 3] },
      { time: 9, opcode: 0, paramMask: 0, args: [] },
    ] },
    { instructions: [{ time: 0, opcode: 1, paramMask: 0, args: [] }] },
  ],
};

test('往返：entry 元信息', () => {
  const { entries } = parseAnm(buildAnm(SPEC));
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.name, 'roundtrip.png');
  assert.equal(e.width, 4);
  assert.equal(e.height, 2);
  assert.equal(e.format, 1);
  assert.notEqual(e.thtxOffset, null);
});

test('往返：sprite 记录逐字段', () => {
  const [e] = parseAnm(buildAnm(SPEC)).entries;
  assert.equal(e.sprites.length, 2);
  assert.deepEqual(
    e.sprites.map((s) => [s.id, s.x, s.y, s.w, s.h]),
    [[0, 0, 0, 2, 2], [1, 2, 0, 2, 2]],
  );
});

test('往返：指令流逐条（含 time / paramMask / 多参数）', () => {
  const [e] = parseAnm(buildAnm(SPEC)).entries;
  assert.equal(e.scripts.length, 2);
  assert.deepEqual(
    e.scripts[0].instructions.map((i) => [i.time, i.opcode, i.paramMask, i.args]),
    [[0, 300, 0, [1]], [5, 400, 0x2, [1, 10004, 3]], [9, 0, 0, []]],
  );
  assert.equal(e.scripts[1].instructions.length, 1, '第二条脚本的 -1 终止符不计入');
});

test('往返：script 的 id 原样保留（可为负，01 §5）', () => {
  const [e] = parseAnm(buildAnm(SPEC)).entries;
  assert.equal(e.scripts[0].id, -7);
  assert.equal(e.scripts[1].id, 1, '不给就用序号');
});

test('往返：贴图像素（RGBA → format 1 的 BGRA → 解回 RGBA）', () => {
  const rgba = new Uint8Array(4 * 2 * 4);
  for (let i = 0; i < 8; i++) {
    rgba[i * 4 + 0] = i * 10;      // R
    rgba[i * 4 + 1] = 200 - i * 5; // G
    rgba[i * 4 + 2] = 7;           // B
    rgba[i * 4 + 3] = 255;
  }
  const bytes = buildAnm({ ...SPEC, rgba });
  const [e] = parseAnm(bytes).entries;
  const t = decodeThtx(bytes, e.thtxOffset);
  assert.equal(t.width, 4);
  assert.equal(t.height, 2);
  assert.equal(t.format, 1);
  assert.deepEqual([...t.rgba], [...rgba], 'R/B 换位来回两次要正好还原');
});

test('不给 rgba 就是全白不透明（自测页要的「一定看得见」）', () => {
  const bytes = buildAnm({ ...SPEC, rgba: undefined });
  const [e] = parseAnm(bytes).entries;
  const t = decodeThtx(bytes, e.thtxOffset);
  assert.deepEqual([...t.rgba.slice(0, 4)], [255, 255, 255, 255]);
});

test('01 §10 的恒等式：name_offset == 0x40 + 4×n_sprites + 8×n_scripts', () => {
  const bytes = buildAnm(SPEC);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0x10, true), 0x40 + 2 * 4 + 2 * 8);
});

// ── 多 entry + 无损重建（编辑器要靠这些）────────────────────────────────────────
// 开发时另外跑过全量验证：把 54 个真实 th16 `.anm` 全部重建，**54/54 逐字段解回原样**，
// 总大小 249.64 MB → 249.63 MB。真实文件不在本仓，那一轮不能做成测试。
import { buildAnmFile } from '../src/format/anm-v8-write.js';

const TWO = {
  entries: [
    { name: 'a.png', width: 8, height: 8, format: 1, xOffset: 3, yOffset: 5, memoryPriority: 10, lowResScale: 1,
      sprites: [{ id: 0, x: 0, y: 0, w: 4, h: 4 }],
      scripts: [{ id: -3, instructions: [{ time: 0, opcode: 300, paramMask: 0, args: [0] }] }] },
    { name: 'b.png', width: 4, height: 4, format: 3,
      sprites: [{ id: 1, x: 1, y: 1, w: 2, h: 2 }, { id: 2, x: 0, y: 0, w: 1, h: 1 }],
      scripts: [{ id: 9, instructions: [{ time: 7, opcode: 1, paramMask: 0, args: [] }] }],
      hasTexture: false },
  ],
};

test('多 entry：next_offset 链表把两个 entry 串起来', () => {
  const { entries } = parseAnm(buildAnmFile(TWO));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.name), ['a.png', 'b.png']);
  assert.equal(entries[1].format, 3, '各 entry 的 format 各自保留');
});

test('★ sprite 的 id 是**跨 entry 的全局序号**，不是 entry 内序号（01 §4）', () => {
  // 第一版写死成 entry 内下标，会把第二个 entry 的 sprite id 从 1,2 改成 0,1。
  // 加载器确实不读这个字段——但那是**改了用户的文件**。真实数据里 ascii.anm 的
  // 第二个 entry 首个 sprite id 是 290，全量重建时就是这条把 54 个文件全打回来的。
  const { entries } = parseAnm(buildAnmFile(TWO));
  assert.deepEqual(entries[1].sprites.map((s) => s.id), [1, 2]);
});

test('★ 没贴图的 entry 不该凭空造一块空白贴图', () => {
  // 第一版对 thtxRaw 为空的 entry 一律分配 w*h*4 字节的空白贴图，白白撑大文件。
  const { entries } = parseAnm(buildAnmFile(TWO));
  assert.equal(entries[1].thtxOffset, null, 'has_data = 0');
  assert.notEqual(entries[0].thtxOffset, null, '有 rgba/默认的那个仍然有贴图');
});

test('无损字段（加载器不读，但属于文件）原样带回来', () => {
  const [a] = parseAnm(buildAnmFile(TWO)).entries;
  assert.equal(a.xOffset, 3);
  assert.equal(a.yOffset, 5);
  assert.equal(a.memoryPriority, 10);
  assert.equal(a.lowResScale, 1);
});

test('thtxRaw 原样透传：不重编码，format 3/5/7 的贴图不会被改成 1', () => {
  // 先造一个 format 1 的文件，取出它的 thtxRaw，声明成 format 5 塞回去——
  // 透传正确的话字节应当一模一样（重编码的话会按 format 1 重写）。
  const src = parseAnm(buildAnm(SPEC));
  const raw = src.entries[0].thtxRaw;
  const out = parseAnm(buildAnmFile({ entries: [{ ...SPEC, format: 5, thtxRaw: raw }] }));
  assert.deepEqual([...out.entries[0].thtxRaw], [...raw], '整块字节原样');
  assert.equal(out.entries[0].format, 5, 'entry.format 按声明走');
});
