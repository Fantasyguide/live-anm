// 可编辑文档模型：`.anm` 字节 ↔ 「entry / sprite / script 文本」的中间层。
// Vue 组件只碰这个模型，不直接碰字节。
import { parseAnm } from '@engine/format/anm-v8.js';
import { buildAnmFile } from '@engine/format/anm-v8-write.js';
import { assemble, disassembleText } from '@engine/asm.js';
import { toThanm, fromThanm } from '@engine/thanm-syntax.js';

// 两种视图：'raw' 贴着机器（时间写在每条指令上、跳转是原始字节偏移），
// 'thanm' 贴着人（时间标签行 + 跳转标签 + sprite/script 名）。两边产出同一份指令。
export const VIEWS = { raw: { emit: disassembleText, parse: assemble },
                       thanm: { emit: toThanm, parse: fromThanm } };

/** 字节 → 可编辑文档。脚本以**文本**形式持有（编辑的就是它）。 */
export function toDoc(bytes, view = 'raw') {
  const parsed = parseAnm(bytes);
  return {
    entries: parsed.entries.map((e) => ({
      ...e,
      sprites: e.sprites.map((s) => ({ ...s })),
      scriptTexts: e.scripts.map((s) => VIEWS[view].emit(s.instructions)),
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
export function docToBytes(doc, view = 'raw') {
  const errors = [];
  // sourceLines[全局 script 序号][指令下标] = 文本行号。编辑器高亮「正在执行哪一行」要用：
  // 文本里有注释和空行 ⇒ 指令下标 ≠ 行号。
  const sourceLines = [];
  const entries = doc.entries.map((e, ei) => ({
    ...e,
    sprites: e.sprites,
    scripts: e.scriptTexts.map((text, i) => {
      const r = VIEWS[view].parse(text);
      r.errors.forEach((err) => errors.push({ ...err, entryIndex: ei, scriptIndex: i, entryName: e.name }));
      sourceLines.push(r.sourceLines);   // 与 flatScripts 的顺序一致（entry 内序号递增）
      return { id: e.scripts[i]?.id ?? i, instructions: r.instructions };
    }),
  }));
  return { bytes: buildAnmFile({ entries }), errors, sourceLines };
}

export function addScript(doc, entryIndex, view = 'raw') {
  const e = doc.entries[entryIndex];
  e.scriptTexts.push(newScriptText(view));
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

/**
 * 切换视图：把每个脚本的文本用当前视图解析、再用目标视图重新输出。
 * 有汇编错误就**拒绝切换**（否则会静默丢掉写坏的那几行），把错误交回去显示。
 */
export function switchView(doc, from, to) {
  const errors = [];
  const next = doc.entries.map((e, ei) => e.scriptTexts.map((text, i) => {
    const r = VIEWS[from].parse(text);
    r.errors.forEach((err) => errors.push({ ...err, entryIndex: ei, scriptIndex: i, entryName: e.name }));
    return r.errors.length ? text : VIEWS[to].emit(r.instructions);
  }));
  if (errors.length) return { ok: false, errors };
  doc.entries.forEach((e, ei) => { e.scriptTexts = next[ei]; });
  return { ok: true, errors: [] };
}

export function newScriptText(view) {
  return view === 'thanm'
    ? '0:\n    sprite(sprite0);\n    pos(0, 0, 0);\n+60: // 60\n    nop();'
    : '0: sprite(0);\n0: pos(0, 0, 0);\n60: nop();';
}
