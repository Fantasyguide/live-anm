import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnmFile } from '../src/format/anm-v8-write.js';
import { parseAnm } from '../src/format/anm-v8.js';
import { inspectAnm, dumpScript, replaceScript, runScript } from '../cli/core.js';

function fixture() {
  return buildAnmFile({ entries: [
    { name: 'first.png', width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 4]),
      sprites: [{ id: 99, x: 0, y: 0, w: 1, h: 1 }],
      scripts: [{ id: -7, instructions: [{ time: 0, opcode: 112, paramMask: 1, args: [10000, 23] }] }] },
    { name: 'second.png', hasTexture: false, width: 2, height: 3,
      sprites: [{ id: 5, x: 1, y: 2, w: 3, h: 4 }],
      scripts: [{ id: 42, instructions: [{ time: 0, opcode: 3, paramMask: 0, args: [] }] }] },
  ] });
}

test('metadata and dump use global indices, preserving raw IDs', () => {
  const bytes = fixture();
  const info = inspectAnm(bytes);
  assert.deepEqual(info.scripts.map(({ index, entryIndex, indexInEntry, id }) => ({ index, entryIndex, indexInEntry, id })), [
    { index: 0, entryIndex: 0, indexInEntry: 0, id: -7 },
    { index: 1, entryIndex: 1, indexInEntry: 0, id: 42 },
  ]);
  assert.equal(info.sprites[1].id, 5);
  assert.equal('instructions' in info.scripts[0], false);
  assert.equal('thtxRaw' in info.entries[0], false);
  assert.equal(dumpScript(bytes, 1, 'raw').text, '0: stop();');
  assert.match(dumpScript(bytes, 1, 'thanm').text, /stop\(\);/);
  assert.throws(() => dumpScript(bytes, 42), { code: 'USAGE' });
});

test('single-script replacement preserves other instructions, sprites and THTX', () => {
  const bytes = fixture();
  const before = parseAnm(bytes);
  const result = replaceScript(bytes, 1, '0: alpha(128);\n0: stop();', 'raw');
  assert.deepEqual(result.errors, []);
  const after = parseAnm(result.bytes);
  assert.equal(after.entries[1].scripts[0].id, 42);
  assert.deepEqual(after.entries[1].scripts[0].instructions, [
    { time: 0, opcode: 403, paramMask: 0, args: [128] },
    { time: 0, opcode: 3, paramMask: 0, args: [] },
  ]);
  assert.deepEqual(after.entries[0].scripts, before.entries[0].scripts);
  assert.deepEqual(after.entries.map(e => e.sprites), before.entries.map(e => e.sprites));
  assert.deepEqual(after.entries[0].thtxRaw, before.entries[0].thtxRaw);
  assert.equal(after.entries[1].hasTexture, false);
});

test('replacement rejects assembly and binary encoding errors without bytes', () => {
  const bytes = fixture();
  for (const text of ['\ninvalid', '32768: stop();', '0: ins_32768();', `0: ins_999(${Array(16382).fill('0').join(',')});`]) {
    const result = replaceScript(bytes, 1, text, 'raw');
    assert.equal(result.bytes, null);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].line > 0);
  }
  assert.throws(() => replaceScript(bytes, 2, '0: stop();', 'raw'), { code: 'USAGE' });
});

test('run steps count manager calls and retain the deleted root snapshot', () => {
  const bytes = buildAnmFile({ entries: [{ hasTexture: false, scripts: [{ id: -7, instructions: [
    { time: 0, opcode: 100, paramMask: 1, args: [10000, 17] },
    { time: 0, opcode: 1, paramMask: 0, args: [] },
  ] }] }] });
  const initial = runScript(bytes, 0, { steps: 0 });
  assert.equal(initial.root.pc, 0);
  assert.equal(initial.root.alive, true);
  assert.deepEqual(initial.root.i, [0, 0, 0, 0]);
  const final = runScript(bytes, 0, { steps: 1 });
  assert.equal(final.steps, 1);
  assert.equal(final.root.alive, false);
  assert.deepEqual(final.root.i, [17, 0, 0, 0]);
  assert.deepEqual(final.vms, []);
  assert.doesNotThrow(() => JSON.stringify(final));
});

test('run reports file-level unknown opcodes and final-frame skipped drawing safely', () => {
  const bytes = buildAnmFile({ entries: [{ hasTexture: false, scripts: [
    { instructions: [{ time: 0, opcode: 3, paramMask: 0, args: [] }] },
    { instructions: [{ time: 0, opcode: 998, paramMask: 0, args: [] }] },
  ] }] });
  const result = runScript(bytes, 0, { steps: 1 });
  assert.ok(result.warnings.some(w => w.code === 'UNREGISTERED_OPCODE' && w.scriptIndex === 1 && w.opcode === 998));
  assert.ok(result.warnings.some(w => w.code === 'DRAW_SKIPPED' && w.scriptIndex === 0 && /final/i.test(w.message)));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('runtime failure reports completed steps without claiming rollback', () => {
  const bytes = buildAnmFile({ entries: [{ hasTexture: false, scripts: [{ instructions: [
    { time: 1, opcode: 100, paramMask: 0, args: [10000, 17] },
  ] }] }] });
  assert.throws(() => runScript(bytes, 0, { steps: 2 }), error => {
    assert.equal(error.code, 'RUN_FAILED');
    assert.deepEqual(error.details, { completedSteps: 1, scriptIndex: 0 });
    return true;
  });
});
