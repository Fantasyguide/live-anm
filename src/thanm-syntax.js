// **thanm 语法糖**视图：与 `asm.js` 的「原始视图」互补。
//
//   原始（asm.js）              thanm 语法糖（本文件）
//   0: sprite(3);               +0: // 0
//   0: pos(100, 50, 0);         sprite(sprite3);
//   0: jmp(12, 0);              offset12:
//                               pos(100, 50, 0);
//                               jmp(offset12, 0);
//
// 原始视图贴着机器（时间写在每条指令上、跳转是**原始字节偏移**）；语法糖贴着人
// （时间是独立的标签行、跳转用**标签名**）。手写脚本时后者几乎是必需的——
// 原始视图里插一条指令，后面所有跳转偏移就全错了，人是没法维护的。
//
// 语法照抄 thanm 的 `ScriptStatement` 文法（anmparse.y）与它反汇编时的输出形式
// （thanm.c `anm_stringify_param`）：
//   `N:`  绝对时间   ·  `+N:`  相对时间   ·  `名字:`  跳转标签
//   `o` → `offset<字节偏移>` · `n` → `sprite<号>`（负数保持原样）· `N` → `script<号>`
import { opcodeName, OPCODES } from './opcodes.js';
import { signatureOf } from './signatures.js';

const INSTR_HEADER_SIZE = 8;
const NAME_TO_OP = new Map(Object.entries(OPCODES).map(([op, [name]]) => [name, Number(op)]));
const VAR_ALIASES = { I0: 10000, I1: 10001, I2: 10002, I3: 10003, F0: 10004, F1: 10005, F2: 10006, F3: 10007 };
const ALIAS_OF = Object.fromEntries(Object.entries(VAR_ALIASES).map(([k, v]) => [v, k]));

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const fbits = (v) => { f32[0] = v; return u32[0]; };
const asFloat = (raw) => { u32[0] = raw >>> 0; return f32[0]; };
const sizeOf = (ins) => INSTR_HEADER_SIZE + (ins.args?.length ?? 0) * 4;

/** 每条指令的字节偏移（01 §5.1：8 + 4×参数个数 累加）。 */
export function offsetsOf(instructions) {
  const out = [];
  let at = 0;
  for (const ins of instructions) { out.push(at); at += sizeOf(ins); }
  return out;
}

function fmtFloat(raw) {
  const v = asFloat(raw);
  return Object.is(fbits(Number(v.toFixed(6))), raw >>> 0) ? String(Number(v.toFixed(6))) : String(v);
}

/** 指令数组 → thanm 语法糖文本。 */
export function toThanm(instructions) {
  const offsets = offsetsOf(instructions);
  const byOffset = new Map(offsets.map((o, i) => [o, i]));
  // 收集跳转目标：任何角色为 `o` 的参数（非变量）都是一个标签点
  const targets = new Set();
  instructions.forEach((ins) => {
    const sig = signatureOf(ins.opcode);
    if (!sig) return;
    ins.args.forEach((raw, k) => {
      if (sig[k] === 'o' && ((ins.paramMask >>> k) & 1) === 0) targets.add(raw | 0);
    });
  });

  const lines = [];
  let time = 0;
  let started = false;
  instructions.forEach((ins, i) => {
    if (targets.has(offsets[i])) lines.push(`offset${offsets[i]}:`);
    if (!started || ins.time !== time) {
      // thanm 的形式：负时间打绝对值，其余打相对 + 绝对值注释
      if (ins.time < 0 || !started) lines.push(`${ins.time}:`);
      else lines.push(`+${ins.time - time}: // ${ins.time}`);
      time = ins.time;
      started = true;
    }
    const sig = signatureOf(ins.opcode);
    const args = ins.args.map((raw, k) => {
      const role = sig ? sig[k] : 'S';
      if (((ins.paramMask >>> k) & 1) === 1) {
        const id = role === 'f' ? Math.trunc(asFloat(raw)) : raw | 0;
        return `$${ALIAS_OF[id] ?? id}`;
      }
      if (role === 'f') return fmtFloat(raw);
      const n = raw | 0;
      if (role === 'o') return byOffset.has(n) ? `offset${n}` : String(n);
      if (role === 'n') return n < 0 ? String(n) : `sprite${n}`;   // sprite(-1) = 不用贴图
      if (role === 'N') return n < 0 ? String(n) : `script${n}`;
      return String(n);
    });
    lines.push(`    ${opcodeName(ins.opcode)}(${args.join(', ')});`);
  });
  return lines.join('\n');
}

/**
 * thanm 语法糖文本 → 指令数组。**两趟**：先算出每条指令的字节偏移并登记标签，
 * 再回填 `o` 参数——标签可以前向引用。
 * @returns {{ instructions: Array, errors: Array<{line:number,message:string}>, sourceLines: number[] }}
 */
export function fromThanm(text) {
  const errors = [];
  const raw = [];          // { time, opcode, args:[{tok,role}], paramMask, line, offset }
  const labels = new Map();
  const lines = text.split('\n');
  let time = 0;
  let offset = 0;

  lines.forEach((src0, idx) => {
    const lineNo = idx + 1;
    const src = src0.replace(/\/\/.*$/, '').replace(/#.*$/, '').trim();
    if (!src) return;

    let m;
    if ((m = /^\+(-?\d+)\s*:$/.exec(src))) { time += Number(m[1]); return; }     // +N:
    if ((m = /^(-?\d+)\s*:$/.exec(src))) { time = Number(m[1]); return; }         // N:
    if ((m = /^([A-Za-z_][\w-]*)\s*:$/.exec(src))) {                              // 标签:
      if (labels.has(m[1])) errors.push({ line: lineNo, message: `标签重名：${m[1]}` });
      labels.set(m[1], offset);
      return;
    }
    m = /^([A-Za-z_][\w-]*)\s*\((.*)\)\s*;?$/.exec(src);
    if (!m) { errors.push({ line: lineNo, message: '语法应为  时间: / +时间: / 标签: / 指令名(参数…);' }); return; }

    const name = m[1];
    let opcode = NAME_TO_OP.get(name);
    if (opcode === undefined) {
      const r = /^ins_(\d+)$/.exec(name);
      if (!r) { errors.push({ line: lineNo, message: `不认识的指令 ${name}` }); return; }
      opcode = Number(r[1]);
    }
    const toks = m[2].trim() ? m[2].split(',').map((t) => t.trim()) : [];
    const sig = signatureOf(opcode);
    if (sig && sig.length !== toks.length) {
      errors.push({ line: lineNo, message: `${name} 要 ${sig.length} 个参数（${sig.join('')}），给了 ${toks.length} 个` });
      return;
    }
    raw.push({ time, opcode, toks, sig, line: lineNo, offset });
    offset += INSTR_HEADER_SIZE + toks.length * 4;
  });

  const instructions = [];
  const sourceLines = [];
  for (const r of raw) {
    const args = [];
    let paramMask = 0;
    let bad = false;
    r.toks.forEach((tok, k) => {
      const role = r.sig ? r.sig[k] : 'S';
      if (tok.startsWith('$')) {
        const body = tok.slice(1);
        const id = Object.prototype.hasOwnProperty.call(VAR_ALIASES, body) ? VAR_ALIASES[body] : Number(body);
        if (!Number.isInteger(id)) { errors.push({ line: r.line, message: `第 ${k + 1} 个参数：${tok} 不是合法变量号` }); bad = true; return; }
        paramMask |= 1 << k;
        args.push(role === 'f' ? fbits(id) : id >>> 0);
        return;
      }
      // 标签 / sprite / script 的糖
      let lit = tok;
      if (role === 'o' && /^[A-Za-z_]/.test(tok)) {
        if (!labels.has(tok)) { errors.push({ line: r.line, message: `找不到标签 ${tok}` }); bad = true; return; }
        lit = String(labels.get(tok));
      } else if (role === 'n' && /^sprite(\d+)$/.test(tok)) lit = /^sprite(\d+)$/.exec(tok)[1];
      else if (role === 'N' && /^script(\d+)$/.test(tok)) lit = /^script(\d+)$/.exec(tok)[1];

      const n = Number(lit);
      if (!Number.isFinite(n)) { errors.push({ line: r.line, message: `第 ${k + 1} 个参数：${tok} 不是数字/标签` }); bad = true; return; }
      if (role === 'f') args.push(fbits(n));
      else if (!Number.isInteger(n)) { errors.push({ line: r.line, message: `第 ${k + 1} 个参数是整型位置，不能写 ${tok}` }); bad = true; }
      else args.push(n >>> 0);
    });
    if (bad) continue;
    instructions.push({ time: r.time, opcode: r.opcode, paramMask, args });
    sourceLines.push(r.line);
  }
  return { instructions, errors, sourceLines };
}
