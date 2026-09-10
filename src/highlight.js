// 轻量语法高亮：一行文本 → token 数组。**纯函数、宽容、不抛**——高亮是装饰，
// 遇到写了一半的、语法不对的内容也要照样出结果，不能让编辑器空掉。
//
// 两种视图（原始 / thanm 语法糖）共用这一套 tokenizer：它们的差别只在**行的形状**
// （原始是 `时间: 指令(...)`，语法糖是独立的 `时间:` / `标签:` 行），token 种类是一样的。
//
// 不引 CodeMirror 之类的编辑器框架：语法是行式的，而 opcode 表与签名表本来就在手边，
// 自己扫一遍几十行就够，还能**按 opcode 分组着色**——那是通用高亮器给不了的。
import { OPCODES } from './opcodes.js';

const NAME_TO_OP = new Map(Object.entries(OPCODES).map(([op, [name]]) => [name, Number(op)]));
// 分组名直接当 CSS class 用会踩坑：`Child management` 带空格，`'g-' + g` 会被拆成
// 两个 class。所以这里出的是**CSS 安全的 slug**（分组只用于着色，不用于显示）。
const GROUP_OF = new Map(Object.entries(OPCODES).map(([op, [name, group]]) => [name, group.replace(/\W+/g, '')]));

const IDENT = /^[A-Za-z_][\w-]*/;
const NUMBER = /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/;
const REF = /^(?:offset|sprite|script)-?\d+$/;

/**
 * @param {string} line 一行源码
 * @returns {Array<{t:string, s:string, g?:string}>} t = token 类，g = opcode 分组（着色用）
 */
export function tokenizeLine(line) {
  const out = [];
  let i = 0;
  const push = (t, s, g) => { if (s) out.push(g ? { t, s, g } : { t, s }); };

  while (i < line.length) {
    const rest = line.slice(i);

    // 注释吃到行尾
    if (rest.startsWith('//') || rest.startsWith('#')) { push('comment', rest); break; }

    // 空白
    const ws = /^\s+/.exec(rest);
    if (ws) { push('ws', ws[0]); i += ws[0].length; continue; }

    // 变量：$I0 / $10022
    if (rest[0] === '$') {
      const m = /^\$[\w]*/.exec(rest);
      push('var', m[0]); i += m[0].length; continue;
    }

    // 标识符：指令名 / 标签 / offsetN·spriteN·scriptN 引用
    const id = IDENT.exec(rest);
    if (id) {
      const word = id[0];
      const after = rest.slice(word.length);
      const nextCh = after.replace(/^\s*/, '')[0];
      if (nextCh === '(') push(NAME_TO_OP.has(word) ? 'op' : 'unknown', word, GROUP_OF.get(word));
      else if (nextCh === ':') push('label', word);
      else if (REF.test(word)) push('ref', word);
      else push('ident', word);
      i += word.length;
      continue;
    }

    // 数字；后面紧跟 `:` 的是时间标签
    const num = NUMBER.exec(rest);
    if (num) {
      const after = rest.slice(num[0].length).replace(/^\s*/, '');
      push(after[0] === ':' ? 'time' : 'num', num[0]);
      i += num[0].length;
      continue;
    }

    if (':(),;'.includes(rest[0])) { push('punct', rest[0]); i += 1; continue; }
    push('text', rest[0]); i += 1;
  }
  return out;
}

/** 整段文本逐行 tokenize。 */
export function tokenizeText(text) {
  return text.split('\n').map(tokenizeLine);
}
