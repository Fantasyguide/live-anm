// thanm 语法糖视图的往返测试。
//
// 开发时另外用 54 个真实 th16 `.anm` 跑过全量往返：**1929 个 script / 41339 条指令、
// 生成 734 个跳转标签，零报错零不吻合**。真实文件不在本仓，这里用合成语料。
import test from 'node:test';
import assert from 'node:assert/strict';
import { toThanm, fromThanm, offsetsOf } from '../src/thanm-syntax.js';
import { assemble } from '../src/asm.js';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const fb = (v) => { f32[0] = v; return u32[0]; };
const rt = (ins) => fromThanm(toThanm(ins)).instructions;

test('字节偏移 = 8 + 4×参数个数 累加（01 §5.1）', () => {
  assert.deepEqual(offsetsOf([
    { opcode: 300, args: [0] },            // 12 字节
    { opcode: 400, args: [0, 0, 0] },      // 20 字节
    { opcode: 0, args: [] },               // 8 字节
  ]), [0, 12, 32]);
});

test('★ 跳转目标印成 offset<字节偏移> 标签，并在目标指令前插入标签行', () => {
  // 这是语法糖存在的理由：原始视图里插一条指令，后面所有跳转偏移就全错了，人没法维护。
  const ins = [
    { time: 0, opcode: 300, paramMask: 0, args: [3] },   // offset 0
    { time: 0, opcode: 0, paramMask: 0, args: [] },      // offset 12  ← 跳这里
    { time: 0, opcode: 200, paramMask: 0, args: [12, 0] },
  ];
  const t = toThanm(ins);
  assert.match(t, /^offset12:$/m, '目标指令前有标签行');
  assert.match(t, /jmp\(offset12, 0\);/, '跳转参数用标签名');
  assert.deepEqual(rt(ins), ins, '解回去还是原来的字节偏移');
});

test('时间：首条打绝对值，之后打相对 +N（thanm 的形式）；负时间打绝对值', () => {
  const ins = [
    { time: -1, opcode: 0, paramMask: 0, args: [] },
    { time: 0, opcode: 0, paramMask: 0, args: [] },
    { time: 30, opcode: 0, paramMask: 0, args: [] },
  ];
  const t = toThanm(ins);
  assert.match(t, /^-1:$/m);
  assert.match(t, /^\+30: \/\/ 30$/m, '相对 +30，注释给绝对值');
  assert.deepEqual(rt(ins), ins);
});

test('sprite / script 号印成名字；sprite 负数保持原样（-1 = 不用贴图）', () => {
  const ins = [
    { time: 0, opcode: 300, paramMask: 0, args: [7] },
    { time: 0, opcode: 300, paramMask: 0, args: [-1 >>> 0] },
    { time: 0, opcode: 500, paramMask: 0, args: [5] },
  ];
  const t = toThanm(ins);
  assert.match(t, /sprite\(sprite7\);/);
  assert.match(t, /sprite\(-1\);/, 'thanm 对负 sprite 也是打原始数字');
  assert.match(t, /createChild\(script5\);/);
  assert.deepEqual(rt(ins), ins);
});

test('变量参数：两种编码都保留（整型十进制 / 浮点 f32 位模式）', () => {
  const ins = [
    { time: 0, opcode: 403, paramMask: 1, args: [10000] },
    { time: 0, opcode: 400, paramMask: 1, args: [fb(10004), 0, 0] },
  ];
  const t = toThanm(ins);
  assert.match(t, /alpha\(\$I0\);/);
  assert.match(t, /pos\(\$F0, 0, 0\);/);
  assert.deepEqual(rt(ins), ins);
});

test('标签可以前向引用（两趟解析）', () => {
  const { instructions, errors } = fromThanm([
    '0:',
    '    jmp(later, 0);',
    '    nop();',
    'later:',
    '    delete();',
  ].join('\n'));
  assert.deepEqual(errors, []);
  // jmp 有 2 个参数 ⇒ 8 + 2×4 = 16 字节；nop 无参 ⇒ 8 字节；所以 later = 24
  assert.deepEqual(instructions[0].args, [24, 0]);
});

test('找不到的标签 / 重名标签都报错，不静默', () => {
  const a = fromThanm('0:\n  jmp(nowhere, 0);');
  assert.match(a.errors[0].message, /找不到标签/);
  const b = fromThanm('x:\nx:\n  nop();');
  assert.match(b.errors[0].message, /标签重名/);
});

test('两种视图产出同一份指令（原始 ↔ 语法糖可互换）', () => {
  const rawText = '0: sprite(3);\n0: nop();\n10: jmp(12, 0);';
  const a = assemble(rawText).instructions;
  const b = fromThanm(toThanm(a)).instructions;
  assert.deepEqual(b, a);
});

test('sourceLines 在语法糖视图下同样正确（标签行与时间行不占指令位）', () => {
  const { instructions, sourceLines } = fromThanm([
    '0:',            // 行 1
    'lbl:',          // 行 2
    '  sprite(sprite0);',  // 行 3 → 指令 0
    '+10: // 10',    // 行 4
    '  nop();',      // 行 5 → 指令 1
  ].join('\n'));
  assert.equal(instructions.length, 2);
  assert.deepEqual(sourceLines, [3, 5]);
  assert.deepEqual(instructions.map((i) => i.time), [0, 10]);
});
