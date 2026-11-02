import { createPlayer } from './player.js';
import { createGifPlan, flipRgbaRows } from './gif-plan.js';

/** 使用最近已应用的文件独立重播，返回可下载的 GIF 字节。 */
export async function exportAnmGif(file, scriptIndex, options) {
  const plan = createGifPlan(options);
  if (!file?.scripts[scriptIndex]) throw new Error('请先选择脚本并应用到预览');
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const { signal, onProgress = () => {} } = options;
  const checkCancelled = () => {
    if (signal?.aborted) throw new DOMException('已取消导出', 'AbortError');
  };
  checkCancelled();
  const canvas = document.createElement('canvas');
  let gl;
  try {
    const player = createPlayer(canvas, file, { width: plan.width, height: plan.height });
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    player.spawn(scriptIndex, { entityPos: options.entityPos });
    const gif = GIFEncoder();
    const crop = plan.crop;
    const pixels = new Uint8Array(crop.width * crop.height * 4);
    onProgress(0, plan.frames.length);
    for (let i = 0; i < plan.frames.length; i++) {
      checkCancelled();
      const frame = plan.frames[i];
      while (player.frame < frame.sourceFrame) player.step();
      player.render();
      if (player.errors.length) throw new Error(`脚本播放失败：${player.errors.at(-1).message}`);
      // UI 原点在左上；WebGL readPixels 原点在左下，且输出行顺序也相反。
      gl.readPixels(crop.x, plan.height - crop.y - crop.height, crop.width, crop.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const rgba = flipRgbaRows(pixels, crop.width, crop.height);
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), crop.width, crop.height, {
        palette, delay: frame.delay, repeat: plan.repeat,
      });
      onProgress(i + 1, plan.frames.length);
      // 每帧交还主线程，让进度、取消按钮和原有播放器继续响应。
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    checkCancelled();
    gif.finish();
    return gif.bytes();
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
