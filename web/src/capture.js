/** 导出在完整画布内裁剪，坐标原点为左上。读取像素前完成校验。 */
export function captureRegion(width, height, crop) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 65535)) {
    throw new Error('画布宽高必须是有效的正整数');
  }
  const region = crop == null ? { x: 0, y: 0, width, height } : {
    x: crop?.x, y: crop?.y, width: crop?.width, height: crop?.height,
  };
  if (!Object.values(region).every(Number.isInteger) || region.x < 0 || region.y < 0 ||
      !(region.width > 0 && region.height > 0) || region.x + region.width > width || region.y + region.height > height) {
    throw new Error('导出范围必须是画布内的整数矩形，宽高至少为 1');
  }
  return region;
}

export function flipRgbaRows(pixels, width, height) {
  const result = new Uint8Array(pixels.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    result.set(pixels.subarray(y * stride, (y + 1) * stride), (height - y - 1) * stride);
  }
  return result;
}

export function readRgba(gl, width, height, crop) {
  const region = captureRegion(width, height, crop);
  if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
    throw new Error('WebGL 无法创建指定尺寸的画布');
  }
  const pixels = new Uint8Array(region.width * region.height * 4);
  gl.readPixels(region.x, height - region.y - region.height, region.width, region.height,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL 读取导出像素失败');
  return flipRgbaRows(pixels, region.width, region.height);
}

export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法编码 PNG 图片')), 'image/png');
  });
}

export async function rgbaToPng(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法创建 PNG 画布');
  const image = ctx.createImageData(width, height);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
  return canvasToPng(canvas);
}
