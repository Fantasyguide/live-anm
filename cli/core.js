import { parseAnm } from '../src/format/anm-v8.js';
import { buildAnmFile } from '../src/format/anm-v8-write.js';
import { assemble, disassembleText } from '../src/asm.js';
import { fromThanm, toThanm } from '../src/thanm-syntax.js';
import { flattenFile, createManager } from '../src/host/manager.js';

function error(code, message, details, exitCode = 1) {
  return Object.assign(new Error(message), { code, details, exitCode });
}

function parse(bytes) {
  try { return parseAnm(bytes); }
  catch (cause) { throw error('ANM_PARSE_FAILED', cause.message); }
}

function records(parsed, kind) {
  return parsed.entries.flatMap((entry, entryIndex) => entry[kind].map((record, indexInEntry) => ({
    entryIndex, indexInEntry, record,
  })));
}

function selectScript(parsed, index) {
  const scripts = records(parsed, 'scripts');
  if (!Number.isSafeInteger(index) || index < 0 || index >= scripts.length) {
    throw error('USAGE', `Script index must be between 0 and ${scripts.length - 1} (global index, not raw ID).`, undefined, 2);
  }
  return scripts[index];
}

function checkSyntax(syntax) {
  if (syntax !== 'raw' && syntax !== 'thanm') throw error('USAGE', 'Syntax must be thanm or raw.', undefined, 2);
}

/** Structural inspection only: no pixel decoding or script assembly. */
export function inspectAnm(bytes) {
  const parsed = parse(bytes);
  const scripts = records(parsed, 'scripts').map(({ entryIndex, indexInEntry, record }, index) => ({
    index, entryIndex, indexInEntry, id: record.id, instructionCount: record.instructions.length,
  }));
  const sprites = records(parsed, 'sprites').map(({ entryIndex, indexInEntry, record }, index) => ({
    index, entryIndex, indexInEntry, ...record,
  }));
  const entries = parsed.entries.map((entry, index) => ({
    index, name: entry.name, width: entry.width, height: entry.height, format: entry.format,
    hasTexture: entry.hasTexture, scriptCount: entry.scripts.length, spriteCount: entry.sprites.length,
    xOffset: entry.xOffset, yOffset: entry.yOffset, memoryPriority: entry.memoryPriority, lowResScale: entry.lowResScale,
  }));
  return { summary: { entries: entries.length, scripts: scripts.length, sprites: sprites.length }, entries, scripts, sprites };
}

export function dumpScript(bytes, index, syntax = 'thanm') {
  checkSyntax(syntax);
  const { entryIndex, indexInEntry, record } = selectScript(parse(bytes), index);
  const text = syntax === 'raw' ? disassembleText(record.instructions) : toThanm(record.instructions);
  return { index, entryIndex, indexInEntry, id: record.id, syntax, text };
}

export function replaceScript(bytes, index, text, syntax = 'thanm') {
  checkSyntax(syntax);
  const parsed = parse(bytes);
  const { entryIndex, indexInEntry, record } = selectScript(parsed, index);
  const assembled = syntax === 'raw' ? assemble(text) : fromThanm(text);
  const errors = [...assembled.errors];
  assembled.instructions.forEach((instruction, i) => {
    const report = message => errors.push({ line: assembled.sourceLines[i], message });
    if (!Number.isInteger(instruction.time) || instruction.time < -32768 || instruction.time > 32767) {
      report('Instruction time must fit a signed 16-bit integer (-32768 to 32767).');
    }
    if (!Number.isInteger(instruction.opcode) || instruction.opcode < -32768 || instruction.opcode > 32767 || instruction.opcode === -1) {
      report('Instruction opcode must fit a signed 16-bit integer and cannot be the -1 end marker.');
    }
    if (8 + instruction.args.length * 4 > 65535) report('Instruction encoding exceeds the unsigned 16-bit size field.');
    if (instruction.paramMask < 0 || instruction.paramMask > 65535) report('Instruction parameter mask exceeds its unsigned 16-bit field.');
  });
  if (errors.length) return { bytes: null, errors };
  const entries = parsed.entries.map((entry, ei) => ei === entryIndex ? {
    ...entry,
    scripts: entry.scripts.map((script, si) => si === indexInEntry ? { ...record, instructions: assembled.instructions } : script),
  } : entry);
  return { bytes: buildAnmFile({ entries }), errors: [] };
}

/** Run through the existing host. VM references stay private to this function. */
export function runScript(bytes, index, { steps = 0, position = { x: 0, y: 0, z: 0 } } = {}) {
  if (!Number.isSafeInteger(steps) || steps < 0) throw error('USAGE', 'Steps must be a non-negative integer.', undefined, 2);
  if (!position || ![position.x, position.y, position.z ?? 0].every(Number.isFinite)) {
    throw error('USAGE', 'Position must contain finite x, y and optional z values.', undefined, 2);
  }
  const parsed = parse(bytes);
  selectScript(parsed, index);
  let completedSteps = 0;
  try {
    const file = flattenFile(bytes, parsed);
    const manager = createManager(file);
    const root = manager.spawn(index, { entityPos: position });
    const scriptIndices = new Map(file.scripts.map((record, i) => [record.script.instructions, i]));
    const snapshot = vm => ({
      scriptIndex: scriptIndices.get(vm._instructions) ?? null,
      pc: vm.pc, time: vm.time, alive: vm.alive, i: [...vm.i], f: [...vm.f],
      pos: { x: vm.pos.x, y: vm.pos.y, z: vm.pos.z },
      rotation: { x: vm.rotation.x, y: vm.rotation.y, z: vm.rotation.z },
      scale: { x: vm.scale.x, y: vm.scale.y },
      spriteId: vm.spriteId ?? null, layer: vm.layer ?? 0, flagsLo: vm.flagsLo, flagsHi: vm.flagsHi,
    });
    const warnings = [];
    file.scripts.forEach((record, scriptIndex) => record.script.instructions.forEach((instruction, instructionIndex) => {
      if (!(instruction.opcode >= 0 && instruction.opcode <= 7) && typeof manager.ops[instruction.opcode] !== 'function') {
        warnings.push({ code: 'UNREGISTERED_OPCODE', scope: 'file', scriptIndex, instructionIndex, opcode: instruction.opcode,
          message: 'Opcode is unregistered and follows the VM no-op behavior; this file diagnostic does not imply execution.' });
      }
    }));
    for (; completedSteps < steps; completedSteps++) manager.step();
    manager.drawList();
    for (const skipped of manager.skipped) {
      warnings.push({ code: 'DRAW_SKIPPED', scope: 'final-frame', scriptIndex: scriptIndices.get(skipped.vm._instructions) ?? null,
        ...(skipped.mode === undefined ? {} : { mode: skipped.mode }),
        message: `Final-frame drawing skipped: ${skipped.reason}` });
    }
    return { steps: completedSteps, root: snapshot(root), vms: manager.vms.map(snapshot), warnings };
  } catch (cause) {
    throw error('RUN_FAILED', `Run failed after ${completedSteps} completed steps: ${cause.message}`, { completedSteps, scriptIndex: index });
  }
}
