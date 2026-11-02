import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrng } from '../src/vm/prng.js';

test('TH16 draw32：与 renkolab 独立参考模型的固定序列一致', () => {
  // tooling/ghidra/scripts/th16_prng_model.py 的 draw32 输出，非本实现计算的预期。
  const rng = createPrng(0x1234);
  assert.deepEqual(Array.from({ length: 6 }, () => rng()), [
    0x1eb187a1, 0x2363b669, 0xea43d9ec, 0x8c30419f, 0x2afad885, 0x8ed4480f,
  ]);
});

test('种子截为 16 位、输出保持 unsigned，两条实例独立推进', () => {
  const a = createPrng(0x1ffff), b = createPrng(0xffff);
  assert.equal(a(), 0x047c226d);
  assert.equal(a(), 0xba3119a3);
  assert.equal(b(), 0x047c226d);
});
