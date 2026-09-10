// 可编辑文档模型：`.anm` 字节 ↔ 「entry / sprite / script 文本」的中间层。
// Vue 组件只碰这个模型，不直接碰字节。
import { parseAnm } from '@engine/format/anm-v8.js';
import { buildAnmFile } from '@engine/format/anm-v8-write.js';
import { assemble, disassembleText } from '@engine/asm.js';

/** 字节 → 可编辑文档。脚本以**文本**形式持有（编辑的就是它）。 */
export function toDoc(bytes) {
  const parsed = parseAnm(bytes);
  return {
    entries: parsed.entries.map((e) => ({
      ...e,
      sprites: e.sprites.map((s) => ({ ...s })),
      scriptTexts: e.scripts.map((s) => disassembleText(s.instructions)),
    })),
  };
}

/** 全局序号 ↔ (entry, entry 内序号)。`500 createChild` 用的就是全局序号（01 §5）。 */
export function flatScripts(doc) {
  const out = [];
  doc.entries.forEach((e, ei) => e.scriptTexts.forEach((_, i) => out.push({ entryIndex: ei, i, entryName: e.name, id: e.scripts[i]?.id ?? i })));
  return out;
}
export function flatSprites(doc) {
  const out = [];
  doc.entries.forEach((e, ei) => e.sprites.forEach((s, i) => out.push({ entryIndex: ei, i, sprite: s, entryName: e.name })));
  return out;
}

/** 把所有脚本文本汇编一遍；返回 { bytes, errors }，errors 带 entry / script 定位。 */
export function docToBytes(doc) {
  const errors = [];
  const entries = doc.entries.map((e, ei) => ({
    ...e,
    sprites: e.sprites,
    scripts: e.scriptTexts.map((text, i) => {
      const r = assemble(text);
      r.errors.forEach((err) => errors.push({ ...err, entryIndex: ei, scriptIndex: i, entryName: e.name }));
      return { id: e.scripts[i]?.id ?? i, instructions: r.instructions };
    }),
  }));
  return { bytes: buildAnmFile({ entries }), errors };
}

export function addScript(doc, entryIndex) {
  const e = doc.entries[entryIndex];
  e.scriptTexts.push('0: sprite(0);\n0: pos(0, 0, 0);\n60: nop();');
  e.scripts.push({ id: e.scripts.length, instructions: [] });
}

export function addSprite(doc, entryIndex) {
  const e = doc.entries[entryIndex];
  // id 用全局序号（01 §4：实测恒 = 跨 entry 的运行序号）
  const globalCount = doc.entries.reduce((n, x) => n + x.sprites.length, 0);
  e.sprites.push({ id: globalCount, x: 0, y: 0, w: 16, h: 16 });
}

/** 触发浏览器下载。 */
export function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
