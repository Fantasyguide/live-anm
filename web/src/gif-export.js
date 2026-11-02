import { createPlayer } from './player.js';
import { createGifPlan } from './gif-plan.js';
import { readRgba } from './capture.js';

/** 使用最近已应用的文件独立重播，返回可下载的 GIF 字节。 */
export async function exportAnmGif(file, scriptIndex, options) {
  const plan = createGifPlan(options);
  if (!Number.isInteger(scriptIndex) || scriptIndex < 0 || !file?.scripts[scriptIndex]) throw new Error('请先选择脚本并应用到预览');
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const { signal, onProgress = () => {}, onWarnings = () => {} } = options;
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
    onProgress(0, plan.frames.length);
    for (let i = 0; i < plan.frames.length; i++) {
      checkCancelled();
      const frame = plan.frames[i];
      while (player.frame < frame.sourceFrame) {
        player.step();
        if (player.errors.length) throw new Error(`脚本播放失败：${player.errors.at(-1).message}`);
      }
      player.render();
      if (player.errors.length) throw new Error(`脚本播放失败：${player.errors.at(-1).message}`);
      const rgba = readRgba(gl, plan.width, plan.height, crop);
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
    onWarnings(player.manager.skipped.map(({ vm, mode, reason }) => {
      const index = file.scripts.findIndex((record) => record.script.instructions === vm._instructions);
      return { code: 'DRAW_SKIPPED', scope: 'final-frame',
        ...(index >= 0 ? { scriptIndex: index } : {}), ...(mode === undefined ? {} : { mode }),
        reason, message: `Final-frame drawing skipped: ${reason}` };
    }));
    return gif.bytes();
  } finally {
    gl ??= canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
