import test from 'node:test';
import assert from 'node:assert/strict';
import { spritePreviewLayout } from '../web/src/sprite-preview.js';

test('切片框按真实贴图尺寸定位，并保留小数坐标', () => {
  const sprite = { x: 1.5, y: 1, w: 2, h: 1 };
  const result = spritePreviewLayout(sprite, { width: 8, height: 4 });
  assert.deepEqual(result.outline, { left: 18.75, top: 25, width: 25, height: 25 });
  assert.equal(result.outside, false);
  assert.deepEqual(sprite, { x: 1.5, y: 1, w: 2, h: 1 });
});

test('大切片适配展示区域，保留宽高比例并标明超出贴图', () => {
  const result = spritePreviewLayout({ x: 0, y: 0, w: 1024, h: 512 }, { width: 512, height: 512 });
  assert.deepEqual(result.size, { width: 512, height: 256 });
  assert.equal(result.outside, true);
});

test('空坐标或非正宽高不生成预览布局', () => {
  for (const sprite of [
    { x: '', y: 0, w: 16, h: 16 },
    { x: 0, y: 0, w: 0, h: 16 },
    { x: 0, y: 0, w: 16, h: -1 },
  ]) assert.throws(() => spritePreviewLayout(sprite, { width: 32, height: 32 }));
});
