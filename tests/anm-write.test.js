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
