// 语法高亮 tokenizer 测试。高亮是装饰性的，所以判据是「分类对不对」+「**永远不丢字符**」
// ——把 token 拼回去必须逐字符等于原行，否则高亮层和 textarea 会错位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeLine, tokenizeText } from '../src/highlight.js';

const kinds = (l) => tokenizeLine(l).filter((t) => t.t !== 'ws').map((t) => `${t.t}:${t.s}`);
const rejoin = (l) => tokenizeLine(l).map((t) => t.s).join('');

test('★ 永远不丢字符：拼回去逐字符等于原行', () => {
  const samples = [
    '0: sprite(3);',
    '    pos(100.5, -2, 0);',
    '+10: // 10',
    'offset24:',
    '  jmp(offset24, 0);   // 回跳',
    '# 井号注释',
    '0: pos($F0, $10022, 0);',
    '',
    '   ',
    'garbage ??? {}',
    '0: ins_998(1, 2);',
  ];
  for (const s of samples) assert.equal(rejoin(s), s, JSON.stringify(s));
});

test('指令名带上分组（着色用），未知名字标 unknown', () => {
  const t = tokenizeLine('0: sprite(3);');
  const op = t.find((x) => x.t === 'op');
  assert.equal(op.s, 'sprite');
  assert.equal(op.g, 'Settings');
  assert.equal(tokenizeLine('0: drawLine(1, 2);').find((x) => x.t === 'op').g, 'Drawing');
  assert.equal(tokenizeLine('0: nope(1);').find((x) => x.t === 'unknown').s, 'nope');
  // 分组要是 CSS 安全的 slug：`Child management` 带空格，直接拼进 class 会被拆成两个
  assert.equal(tokenizeLine('0: createChild(1);').find((x) => x.t === 'op').g, 'Childmanagement');
  for (const [, t] of Object.entries({ a: tokenizeLine('0: nop();'), b: tokenizeLine('0: pos(1,2,3);') })) {
    const g = t.find((x) => x.t === 'op')?.g;
    assert.ok(!g || /^\w+$/.test(g), `分组 slug 不能含空白：${g}`);
  }
});

test('时间 / 标签 / 引用各自分类', () => {
  assert.deepEqual(kinds('0: sprite(3);'),
    ['time:0', 'punct::', 'op:sprite', 'punct:(', 'num:3', 'punct:)', 'punct:;']);
  assert.deepEqual(kinds('+10:'), ['time:+10', 'punct::']);
  assert.deepEqual(kinds('offset24:'), ['label:offset24', 'punct::']);
  // 同一个词在参数位置上是引用、在行首带冒号是标签
  assert.deepEqual(kinds('jmp(offset24, 0);'),
    ['op:jmp', 'punct:(', 'ref:offset24', 'punct:,', 'num:0', 'punct:)', 'punct:;']);
  assert.deepEqual(kinds('sprite(sprite7);'), ['op:sprite', 'punct:(', 'ref:sprite7', 'punct:)', 'punct:;']);
  assert.deepEqual(kinds('createChild(script5);'), ['op:createChild', 'punct:(', 'ref:script5', 'punct:)', 'punct:;']);
});

test('变量与注释', () => {
  assert.deepEqual(kinds('pos($F0, $10022, 0);'),
    ['op:pos', 'punct:(', 'var:$F0', 'punct:,', 'var:$10022', 'punct:,', 'num:0', 'punct:)', 'punct:;']);
  assert.deepEqual(kinds('nop(); // 尾注释'), ['op:nop', 'punct:(', 'punct:)', 'punct:;', 'comment:// 尾注释']);
  assert.deepEqual(kinds('# 整行'), ['comment:# 整行']);
});

test('负数与小数不被拆开', () => {
  assert.deepEqual(kinds('pos(-1.5, 2e-3, 0);').filter((k) => k.startsWith('num')),
    ['num:-1.5', 'num:2e-3', 'num:0']);
});

test('宽容：写了一半 / 语法不对也不抛，照样出 token', () => {
  for (const s of ['0: spri', 'pos(', ')));', '$', '+', ':::', '0:']) {
    assert.doesNotThrow(() => tokenizeLine(s), JSON.stringify(s));
    assert.equal(rejoin(s), s);
  }
});

test('tokenizeText 逐行，行数不变（高亮层要和 textarea 行对行）', () => {
  const t = tokenizeText('0:\n  nop();\n\n// 末尾');
  assert.equal(t.length, 4);
  assert.equal(t[2].length, 0, '空行是空 token 数组');
});
