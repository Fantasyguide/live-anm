import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnm } from '../src/format/anm-v8-write.js';
import { parseAnm } from '../src/format/anm-v8.js';
import { toDoc, docToBytes, switchView } from '../web/src/doc.js';

const makeDoc = () => toDoc(buildAnm({
  hasTexture: false,
  scripts: [{ instructions: [{ time: 0, opcode: 0, paramMask: 0, args: [] }] }],
}), 'raw');

test('导出使用文档中的最新脚本文本', () => {
  const doc = makeDoc();
  doc.entries[0].scriptTexts[0] = '0: alpha(128);\n0: stop();';
  const result = docToBytes(doc, 'raw');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(parseAnm(result.bytes).entries[0].scripts[0].instructions, [
    { time: 0, opcode: 403, paramMask: 0, args: [128] },
    { time: 0, opcode: 3, paramMask: 0, args: [] },
  ]);
});

test('汇编错误保留原文并拒绝生成部分 ANM', () => {
  const doc = makeDoc();
  const text = '0: alpha(128);\n0: missingInstruction();';
  doc.entries[0].scriptTexts[0] = text;
  const result = docToBytes(doc, 'raw');
  assert.equal(result.bytes, null);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
  assert.equal(doc.entries[0].scriptTexts[0], text);
});

test('切换视图失败时保留所有脚本的原文', () => {
  const doc = makeDoc();
  doc.entries[0].scriptTexts = ['0: alpha(128);', '// 草稿\n未完成的代码'];
  const before = doc.entries[0].scriptTexts.slice();
  const result = switchView(doc, 'raw', 'thanm');
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].scriptIndex, 1);
  assert.deepEqual(doc.entries[0].scriptTexts, before);
});
