import test from 'node:test';
import assert from 'node:assert/strict';
import { createGifPlan, flipRgbaRows } from '../web/src/gif-plan.js';

test('局部导出保持原画布尺寸，使用指定的裁剪矩形', () => {
  const plan = createGifPlan({ width: 640, height: 480, crop: { x: 100, y: 50, width: 160, height: 120 } });
  assert.deepEqual(plan.crop, { x: 100, y: 50, width: 160, height: 120 });
  assert.equal(plan.width, 640);
  assert.equal(plan.height, 480);
  assert.equal(plan.frames.length, 60);
  assert.deepEqual(plan.frames.slice(0, 3), [
    { sourceFrame: 1, delay: 50 }, { sourceFrame: 4, delay: 50 }, { sourceFrame: 7, delay: 50 },
  ]);
});

test('30fps 的 GIF 延时累计保持一秒，动画仍按 60Hz 推进', () => {
  const plan = createGifPlan({ width: 16, height: 16, duration: 1, fps: 30, loop: false });
  assert.equal(plan.frames.length, 30);
  assert.equal(plan.frames.reduce((sum, f) => sum + f.delay, 0), 1000);
  assert.equal(plan.frames[29].sourceFrame, 59);
  assert.equal(plan.repeat, -1);
});

test('无效尺寸、超出画布的裁剪和无效时长不会开始导出', () => {
  for (const options of [
    { width: 0, height: 480 },
    { width: 640, height: 480, crop: { x: -1, y: 0, width: 10, height: 10 } },
    { width: 640, height: 480, crop: { x: 600, y: 0, width: 100, height: 10 } },
    { width: 640, height: 480, crop: { x: 0, y: 0, width: 10, height: 0 } },
    { width: 640, height: 480, duration: NaN },
  ]) assert.throws(() => createGifPlan(options));
});

test('WebGL 从下向上的像素行转为 GIF 从上向下的顺序', () => {
  const rgba = new Uint8Array([
    0, 0, 255, 255, 255, 255, 255, 255,
    255, 0, 0, 255, 0, 255, 0, 255,
  ]);
  assert.deepEqual([...flipRgbaRows(rgba, 2, 2)], [
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
});
