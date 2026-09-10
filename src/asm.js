// ANM 脚本的**文本 ↔ 指令**互转。语法参考 thanm 但更简，够在线编辑用。
//
//     // 注释
//     0:   sprite(0);
//     0:   pos(100, 50, 0);
//     30:  alpha(128);
//     60:  nop();
//     0:   pos($F0, 0, 0);        // $ 开头 = 变量号，会置 param_mask 对应位
//     0:   ins_998(1, 2);         // 未知 opcode：按 ins_<n> 写，参数一律当 int32
//
// **参数类型来自签名表**（src/signatures.js），不靠写法猜：`pos(100, 50, 0)` 里的 100
// 会按 `f` 编成 float32 的位模式，而 `alpha(128)` 的 128 按 int32 原样存。这样用户不用
// 记哪个参数是浮点——但也意味着**签名表错了就会静默写坏文件**，所以那张表的参数个数
// 用 41339 条真实指令交叉验过（见 signatures.js 的文件头）。
import { OPCODES, opcodeName } from './opcodes.js';
import { signatureOf } from './signatures.js';

const NAME_TO_OP = new Map(Object.entries(OPCODES).map(([op, [name]]) => [name, Number(op)]));
// 04-variables.md §2 的常用别名。只放文档里明确写了的那几个，不自己发明。
const VAR_ALIASES = { I0: 10000, I1: 10001, I2: 10002, I3: 10003, F0: 10004, F1: 10005, F2: 10006, F3: 10007 };

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const floatToBits = (v) => { f32[0] = v; return u32[0]; };
const bitsToFloat = (raw) => { u32[0] = raw >>> 0; return f32[0]; };

function parseVarId(token) {
  const body = token.slice(1);
  if (Object.prototype.hasOwnProperty.call(VAR_ALIASES, body)) return VAR_ALIASES[body];
  const n = Number(body);
  return Number.isInteger(n) ? n : null;
}

/**
 * 文本 → 指令数组。**不抛**：错误逐条收集，带行号，让编辑器能一次显示全部问题。
 *
 * `sourceLines[i]` = 第 i 条指令来自文本的第几行（1 起）。编辑器里可以有注释和空行，
 * 所以**指令下标 ≠ 行号**——要在编辑器里高亮「正在执行哪一行」就必须有这张表。
 * @returns {{ instructions: Array, errors: Array<{line:number, message:string}>, sourceLines: number[] }}
 */
export function assemble(text) {
  const instructions = [];
  const sourceLines = [];
  const errors = [];
  const lines = text.split('\n');

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const src = raw.replace(/\/\/.*$/, '').replace(/#.*$/, '').trim();
    if (!src) return;

    // ★ 指令名里**有连字符**：`v8-flag-431` / `v8-randMode` / `v8-306` / `slowdown-immune`
    // （thpages 的现名）。第一版正则写的 `[A-Za-z_][\w]*` 不认 `-`，54 个真实文件里
    // 589 个 script 因此往返失败——这条是被真实数据往返测出来的，不是想出来的。
    const m = /^(-?\d+)\s*:\s*([A-Za-z_][\w-]*)\s*\((.*)\)\s*;?\s*$/.exec(src);
    if (!m) {
      errors.push({ line: lineNo, message: '语法应为  时间: 指令名(参数, …);' });
      return;
    }
    const time = Number(m[1]);
    const name = m[2];
    const argText = m[3].trim();

    let opcode = NAME_TO_OP.get(name);
    if (opcode === undefined) {
      const raw2 = /^ins_(\d+)$/.exec(name);
      if (!raw2) { errors.push({ line: lineNo, message: `不认识的指令 ${name}（未知 opcode 请写成 ins_<号>）` }); return; }
      opcode = Number(raw2[1]);
    }

    const tokens = argText ? argText.split(',').map((t) => t.trim()) : [];
    const sig = signatureOf(opcode);
    if (sig && sig.length !== tokens.length) {
      errors.push({ line: lineNo, message: `${name} 要 ${sig.length} 个参数（${sig.join('')}），给了 ${tokens.length} 个` });
      return;
    }

    const args = [];
    let paramMask = 0;
    let bad = false;
    tokens.forEach((tok, k) => {
      // 未知 opcode 没有签名 ⇒ 一律按 int32（不猜）
      const kind = sig ? sig[k] : 'i';
      if (tok.startsWith('$')) {
        const id = parseVarId(tok);
        if (id === null) { errors.push({ line: lineNo, message: `第 ${k + 1} 个参数：${tok} 不是合法的变量号` }); bad = true; return; }
        paramMask |= 1 << k;
        // 03-math-jumps.md §3 ④：浮点指令把变量号编成 float32 的位模式，整型指令写十进制
        args.push(kind === 'f' ? floatToBits(id) : id >>> 0);
        return;
      }
      const n = Number(tok);
      if (!Number.isFinite(n)) { errors.push({ line: lineNo, message: `第 ${k + 1} 个参数：${tok} 不是数字` }); bad = true; return; }
      if (kind === 'f') args.push(floatToBits(n));
      else {
        if (!Number.isInteger(n)) { errors.push({ line: lineNo, message: `第 ${k + 1} 个参数是整型（${name} 的签名），不能写 ${tok}` }); bad = true; return; }
        args.push(n >>> 0);
      }
    });
    if (bad) return;
    instructions.push({ time, opcode, paramMask, args });
    sourceLines.push(lineNo);
  });

  return { instructions, errors, sourceLines };
}

/** 指令数组 → 文本。与 assemble 互为逆运算（往返测试盯着这一点）。 */
export function disassembleText(instructions) {
  return instructions.map((ins) => {
    const sig = signatureOf(ins.opcode);
    const args = ins.args.map((raw, k) => {
      const kind = sig ? sig[k] : 'i';
      const isVar = ((ins.paramMask >>> k) & 1) === 1;
      if (isVar) {
        const id = kind === 'f' ? Math.trunc(bitsToFloat(raw)) : raw | 0;
        const alias = Object.keys(VAR_ALIASES).find((a) => VAR_ALIASES[a] === id);
        return `$${alias ?? id}`;
      }
      if (kind === 'f') {
        const v = bitsToFloat(raw);
        // 保证能被 Number() 读回同一个 float32：优先短表示，不行就用足够精度
        return Object.is(floatToBits(Number(v.toFixed(6))), raw) ? String(Number(v.toFixed(6))) : String(v);
      }
      return String(raw | 0);
    });
    return `${ins.time}: ${opcodeName(ins.opcode)}(${args.join(', ')});`;
  }).join('\n');
}
