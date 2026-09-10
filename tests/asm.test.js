// 文本 ↔ 指令的往返测试。
//
// 往返是这类工具**唯一有意义的正确性判据**：反汇编再汇编，必须逐字段回到原样。
// 开发时另外用 54 个真实 th16 `.anm` 跑过全量往返——**1929 个 script / 41339 条指令，
// 零误差**（真实文件不在本仓，那一轮不能做成测试；这里用合成语料覆盖全部 135 个
// opcode，比真实数据里出现的 91 个还全）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, disassembleText } from '../src/asm.js';
import { SIGNATURES, signatureOf } from '../src/signatures.js';
import { opcodeName } from '../src/opcodes.js';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const fbits = (v) => { f32[0] = v; return u32[0]; };

test('往返：全部 135 个 opcode（按签名造参数，含变量与负数）', () => {
  const src = [];
  const expected = [];
  Object.keys(SIGNATURES).map(Number).sort((a, b) => a - b).forEach((op, n) => {
    const sig = signatureOf(op);
    const args = [];
    const toks = [];
    let mask = 0;
    sig.forEach((kind, k) => {
      if (k === 0 && n % 5 === 0) {           // 每五条把第一个参数写成变量
        mask |= 1;
        const id = kind === 'f' ? 10004 : 10000;
        toks.push(kind === 'f' ? '$F0' : '$I0');
        args.push(kind === 'f' ? fbits(id) : id >>> 0);
      } else if (kind === 'f') {
        const v = (k + 1) * 1.5 * (k % 2 ? -1 : 1);
        toks.push(String(v)); args.push(fbits(v));
      } else {
        const v = (k + 1) * 7;
        toks.push(String(v)); args.push(v >>> 0);
      }
    });
    src.push(`${n}: ${opcodeName(op)}(${toks.join(', ')});`);
    expected.push({ time: n, opcode: op, paramMask: mask, args });
  });

  const { instructions, errors } = assemble(src.join('\n'));
  assert.deepEqual(errors, [], '不该有汇编错误');
  assert.equal(instructions.length, expected.length, '135 条全部汇编出来');
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(instructions[i], expected[i], `opcode ${expected[i].opcode}`);
  }
  // 再反汇编回去，逐字符相同
  assert.equal(disassembleText(instructions), src.join('\n'));
});

test('★ 指令名里的连字符（v8-flag-431 / slowdown-immune 等）能被解析', () => {
  // 第一版正则写的 `[A-Za-z_][\w]*` 不认 `-`，54 个真实文件里 589 个 script 往返失败。
  // 这条是被真实数据测出来的，不是想出来的。
  const { instructions, errors } = assemble('0: v8-flag-431(1);\n0: v8-randMode(1);\n0: slowdown-immune(1);\n0: v8-306(1);');
  assert.deepEqual(errors, []);
  assert.deepEqual(instructions.map((i) => i.opcode), [431, 307, 432, 306]);
});

test('参数类型来自签名表，不靠写法猜', () => {
  const { instructions } = assemble('0: pos(100, 50, 0);\n0: alpha(128);');
  // pos 是 fff ⇒ 100 要编成 float32 的位模式
  assert.deepEqual(instructions[0].args, [fbits(100), fbits(50), fbits(0)]);
  // alpha 是 $ ⇒ 128 原样存
  assert.deepEqual(instructions[1].args, [128]);
});

test('变量：整型指令写十进制、浮点指令写 float32 位模式（03 §3 ④）', () => {
  const { instructions } = assemble('0: alpha($I0);\n0: pos($F0, 0, 0);');
  assert.equal(instructions[0].paramMask, 1);
  assert.equal(instructions[0].args[0], 10000, '整型侧：十进制');
  assert.equal(instructions[1].paramMask, 1);
  assert.equal(instructions[1].args[0], fbits(10004), '浮点侧：位模式');
  // 别名与裸号等价
  assert.deepEqual(assemble('0: pos($10004, 0, 0);').instructions[0].args, instructions[1].args);
});

test('错误逐条收集并带行号，不抛（编辑器要一次显示全部问题）', () => {
  const { instructions, errors } = assemble([
    '0: sprite(0);',
    'garbage line',
    '0: notAnOpcode(1);',
    '0: pos(1, 2);',          // 少一个参数
    '0: alpha(1.5);',         // 整型位置写了小数
    '0: nop();',
  ].join('\n'));
  assert.equal(instructions.length, 2, '好的两行照样汇编出来');
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4, 5]);
  assert.match(errors[1].message, /不认识的指令/);
  assert.match(errors[2].message, /要 3 个参数/);
  assert.match(errors[3].message, /整型/);
});

test('未知 opcode 走 ins_<n>，参数一律当 int32（不猜类型）', () => {
  const { instructions, errors } = assemble('0: ins_998(1, 2);');
  assert.deepEqual(errors, []);
  assert.deepEqual(instructions[0], { time: 0, opcode: 998, paramMask: 0, args: [1, 2] });
  assert.equal(disassembleText(instructions), '0: ins_998(1, 2);');
});

test('注释与空行被忽略；时间可为负（模板预跑段用 -1）', () => {
  const { instructions, errors } = assemble('// 头注释\n\n-1: sprite(3);  // 行尾注释\n# 井号也行\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(instructions, [{ time: -1, opcode: 300, paramMask: 0, args: [3] }]);
});

test('浮点回文本时保证能读回同一个 float32', () => {
  const tricky = [0.1, 1 / 3, -0.0001, 1e20, 3.4028234663852886e38];
  const text = tricky.map((v, i) => `${i}: uVel(${v});`).join('\n');
  const { instructions, errors } = assemble(text);
  assert.deepEqual(errors, []);
  const back = assemble(disassembleText(instructions)).instructions;
  assert.deepEqual(back.map((i) => i.args[0]), instructions.map((i) => i.args[0]));
});

test('sourceLines：指令 ↔ 文本行号（编辑器高亮「正在执行哪一行」要用）', () => {
  // 编辑器里可以有注释和空行 ⇒ **指令下标 ≠ 行号**，必须有这张表。
  const { instructions, sourceLines } = assemble([
    '// 头注释',
    '',
    '0: sprite(0);',      // 行 3
    '',
    '# 井号注释',
    '30: pos(1, 2, 3);',  // 行 6
    '60: nop();',         // 行 7
  ].join('\n'));
  assert.equal(instructions.length, 3);
  assert.deepEqual(sourceLines, [3, 6, 7]);
});

test('sourceLines：出错的行不占位，后续指令的行号仍然对', () => {
  const { instructions, sourceLines, errors } = assemble([
    '0: sprite(0);',   // 行 1 → 指令 0
    'garbage',         // 行 2 → 错误，不产生指令
    '9: nop();',       // 行 3 → 指令 1
  ].join('\n'));
  assert.equal(errors.length, 1);
  assert.equal(instructions.length, 2);
  assert.deepEqual(sourceLines, [1, 3]);
});
