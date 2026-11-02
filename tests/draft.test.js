import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDraft } from '../web/src/draft-store.js';
import { buildAnm } from '../src/format/anm-v8-write.js';
import { toDoc, docToBytes } from '../web/src/doc.js';
import { parseAnm } from '../src/format/anm-v8.js';

const makeDoc = () => toDoc(buildAnm({
  width: 2, height: 2,
  sprites: [{ x: 0, y: 0, w: 2, h: 2 }],
  scripts: [{ instructions: [] }],
}), 'raw');

test('草稿保留无效原文和注释，后续编辑不改变已捕获内容', () => {
  const doc = makeDoc();
  doc.entries[0].scriptTexts[0] = '// 未写完\n0: alpha(';
  const draft = captureDraft(doc, 'test.anm', 'raw', true);
  doc.entries[0].scriptTexts[0] = '0: stop();';
  assert.equal(draft.doc.entries[0].scriptTexts[0], '// 未写完\n0: alpha(');
  assert.equal(draft.fileName, 'test.anm');
  assert.equal(draft.syntaxView, 'raw');
  assert.equal(draft.unexportedChanges, true);
});

test('草稿经结构化克隆后可以用修改后的 Sprite 和原贴图重新导出', () => {
  const doc = makeDoc();
  doc.entries[0].sprites[0].w = 1;
  doc.entries[0].scriptTexts[0] = '0: alpha(128);\n0: stop();';
  const restored = structuredClone(captureDraft(doc, 'test.anm', 'raw', false));
  const result = docToBytes(restored.doc, restored.syntaxView);
  assert.deepEqual(result.errors, []);
  const entry = parseAnm(result.bytes).entries[0];
  assert.equal(entry.sprites[0].w, 1);
  assert.deepEqual(entry.thtxRaw, doc.entries[0].thtxRaw);
  assert.deepEqual(entry.scripts[0].instructions, [
    { time: 0, opcode: 403, paramMask: 0, args: [128] },
    { time: 0, opcode: 3, paramMask: 0, args: [] },
  ]);
  assert.equal(restored.unexportedChanges, false);
});
