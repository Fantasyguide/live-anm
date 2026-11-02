/** 动画按 60Hz 推进；GIF 延时按百分之一秒取整并累计校正。 */
export function createGifPlan({ width, height, crop, duration = 3, fps = 20, loop = true }) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 65535)) {
    throw new Error('画布宽高必须是有效的正整数');
  }
  const region = crop ? { ...crop } : { x: 0, y: 0, width, height };
  if (!Object.values(region).every(Number.isInteger) || region.x < 0 || region.y < 0 ||
      !(region.width > 0 && region.height > 0) || region.x + region.width > width || region.y + region.height > height) {
    throw new Error('导出范围必须是画布内的整数矩形，宽高至少为 1');
  }
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 30) throw new Error('时长请设为 0.1 到 30 秒');
  if (![10, 20, 30].includes(fps)) throw new Error('帧率请选择 10、20 或 30fps');
  const frames = Array.from({ length: Math.ceil(duration * fps) }, (_, i) => ({
    // step() 第一次执行脚本 time=0，所以第 0 个画面在 sourceFrame=1。
    sourceFrame: Math.floor(i * 60 / fps) + 1,
    delay: (Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps)) * 10,
  }));
  return { width, height, crop: region, frames, repeat: loop ? 0 : -1 };
}

export function flipRgbaRows(pixels, width, height) {
  const result = new Uint8Array(pixels.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    result.set(pixels.subarray(y * stride, (y + 1) * stride), (height - y - 1) * stride);
  }
  return result;
}
