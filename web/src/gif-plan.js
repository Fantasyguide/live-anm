import { captureRegion } from './capture.js';
export { flipRgbaRows } from './capture.js';

/** 动画按 60Hz 推进；GIF 延时按百分之一秒取整并累计校正。 */
export function createGifPlan({ width, height, crop, duration = 3, fps = 20, loop = true }) {
  const region = captureRegion(width, height, crop);
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 30) throw new Error('时长请设为 0.1 到 30 秒');
  if (![10, 20, 30].includes(fps)) throw new Error('帧率请选择 10、20 或 30fps');
  const frames = Array.from({ length: Math.ceil(duration * fps) }, (_, i) => ({
    // step() 第一次执行脚本 time=0，所以第 0 个画面在 sourceFrame=1。
    sourceFrame: Math.floor(i * 60 / fps) + 1,
    delay: (Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps)) * 10,
  }));
  return { width, height, crop: region, frames, repeat: loop ? 0 : -1 };
}
