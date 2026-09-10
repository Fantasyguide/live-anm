// 把一段 script 摊成可读的行，并把 `vm.pc`（字节偏移）映射回行号 —— 给 viewer 高亮用。
//
// 依据：01-format.md §5/§5.1（指令头 8 字节、`param_mask` 每位 = 第 i 个参数是变量号）、
//       02-vm-core.md §5（interrupt 与 `5 case` 标签）、
//       03-math-jumps.md §3 ④（浮点指令的变量号编成 float32 位模式）。
import { opcodeName, opcodeGroup } from './opcodes.js';

const INSTR_HEADER_SIZE = 8; // 01 §5.1

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const asFloat = (raw) => { u32[0] = raw >>> 0; return f32[0]; };

// 哪些 opcode 的参数走浮点侧（`get_float_var`）——决定一个裸 u32 该按 float 还是 int 显示。
// 不做全表：只按「这条指令的这个位置是不是 f」判断太细，这里用「组 + 常见签名」近似，
// 并且**把两种解释都显示出来**（`123 / 1.72e-43`），不替读者做选择。
function formatArg(raw, isVar) {
  const i = raw | 0;
  const f = asFloat(raw);
  if (isVar) {
    // 变量号有两种编码：整型指令写十进制、浮点指令写 float32 位模式（03 §3 ④）
    const asVarFloat = Math.trunc(f);
    const id = asVarFloat >= 10000 && asVarFloat <= 10035 ? asVarFloat : i;
    return `$${id}`;
  }
  if (i === 0) return '0';
  const fs = Math.abs(f) >= 1e-4 && Math.abs(f) < 1e7 ? String(Number(f.toFixed(4))) : f.toExponential(2);
  return `${i} / ${fs}`;
}

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
    const args = ins.args.map((a, k) => formatArg(a, ((ins.paramMask >>> k) & 1) === 1));
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
      text: `${opcodeName(ins.opcode)}(${args.join(', ')})`,
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
