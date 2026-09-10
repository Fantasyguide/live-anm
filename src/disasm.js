// 把一段 script 摊成可读的行，并把 `vm.pc`（字节偏移）映射回行号 —— 给 viewer 高亮用。
//
// 依据：01-format.md §5/§5.1（指令头 8 字节、`param_mask` 每位 = 第 i 个参数是变量号）、
//       02-vm-core.md §5（interrupt 与 `5 case` 标签）、
//       03-math-jumps.md §3 ④（浮点指令的变量号编成 float32 位模式）。
import { opcodeName, opcodeGroup } from './opcodes.js';
import { signatureOf } from './signatures.js';

const INSTR_HEADER_SIZE = 8; // 01 §5.1

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const asFloat = (raw) => { u32[0] = raw >>> 0; return f32[0]; };

// 参数怎么显示：**类型来自签名表**（signatures.js），不再「两种解释都印出来」。
// 那个折中是签名表还没做出来时的权宜；现在 135 条的类型是确定的，印错的解释只会误导。
function formatArg(raw, isVar, role) {
  if (isVar) {
    // 03-math-jumps.md §3 ④：浮点指令把变量号编成 float32 位模式，整型指令写十进制
    const id = role === 'f' ? Math.trunc(asFloat(raw)) : raw | 0;
    const alias = VAR_ALIASES[id];
    return `$${alias ?? id}`;
  }
  if (role === 'f') {
    const v = asFloat(raw);
    return Object.is(fbits(Number(v.toFixed(6))), raw >>> 0) ? String(Number(v.toFixed(6))) : String(v);
  }
  return String(raw | 0);
}
// 04-variables.md §2 的常用别名（只放文档明确写了的）
const VAR_ALIASES = { 10000: 'I0', 10001: 'I1', 10002: 'I2', 10003: 'I3', 10004: 'F0', 10005: 'F1', 10006: 'F2', 10007: 'F3' };
const fbits = (v) => { f32[0] = v; return u32[0]; };

/**
 * @param {{instructions: Array}} script
 * @returns {{lines: Array, offsetToLine: Map<number, number>, caseLabels: number[]}}
 */
export function disassemble(script) {
  const lines = [];
  const offsetToLine = new Map();
  const caseLabels = [];
  let offset = 0;
  script.instructions.forEach((ins, index) => {
    offsetToLine.set(offset, index);
    const sig = signatureOf(ins.opcode);
    const args = ins.args.map((a, k) => formatArg(a, ((ins.paramMask >>> k) & 1) === 1, sig ? sig[k] : 'S'));
    // 02 §5：`5 case` 的 arg0 是 interrupt 标签号，扫描时当跳转目标用（运行时是 no-op）
    if (ins.opcode === 5 && ins.args.length) caseLabels.push(ins.args[0] | 0);
    lines.push({
      index,
      offset,
      time: ins.time,
      opcode: ins.opcode,
      name: opcodeName(ins.opcode),
      group: opcodeGroup(ins.opcode),
      args,
      paramMask: ins.paramMask,
      isCase: ins.opcode === 5,
      caseLabel: ins.opcode === 5 && ins.args.length ? (ins.args[0] | 0) : null,
      text: `${ins.time}: ${opcodeName(ins.opcode)}(${args.join(', ')});`,
    });
    offset += INSTR_HEADER_SIZE + ins.args.length * 4;
  });
  return { lines, offsetToLine, caseLabels: [...new Set(caseLabels)].sort((a, b) => a - b) };
}

/** `vm.pc` → 行号；取不到（脚本已终止，pc = -1）返回 -1。 */
export function lineOfPc(disasm, pc) {
  if (pc < 0) return -1;
  return disasm.offsetToLine.has(pc) ? disasm.offsetToLine.get(pc) : -1;
}
