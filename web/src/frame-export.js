import { createPlayer } from './player.js';
import { captureRegion, readRgba, rgbaToPng } from './capture.js';

/** 独立重播；图像帧 0 对应第一次 step（执行脚本 time=0）。 */
export async function exportAnmFrame(file, scriptIndex, options = {}) {
  const { width = 640, height = 480, frame = 0, crop, entityPos, onWarnings = () => {} } = options;
  const region = captureRegion(width, height, crop);
  if (!Number.isInteger(frame) || frame < 0) throw new Error('图像帧号必须是非负整数');
  if (!Number.isInteger(scriptIndex) || scriptIndex < 0 || !file?.scripts[scriptIndex]) {
    throw new Error('请选择有效的脚本全局序号');
  }
  const canvas = document.createElement('canvas');
  let gl;
  try {
    const player = createPlayer(canvas, file, { width, height });
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    player.spawn(scriptIndex, { entityPos: entityPos ?? { x: width / 2, y: height / 2, z: 0 } });
    for (let i = 0; i <= frame; i++) {
      player.step();
      if (player.errors.length) throw new Error(`脚本播放失败：${player.errors.at(-1).message}`);
    }
    player.render();
    if (player.errors.length) throw new Error(`脚本播放失败：${player.errors.at(-1).message}`);
    onWarnings(player.manager.skipped.map(({ vm, mode, reason }) => {
      const index = file.scripts.findIndex((record) => record.script.instructions === vm._instructions);
      return { code: 'DRAW_SKIPPED', scope: 'final-frame',
        ...(index >= 0 ? { scriptIndex: index } : {}), ...(mode === undefined ? {} : { mode }),
        reason, message: `Final-frame drawing skipped: ${reason}` };
    }));
    const blob = await rgbaToPng(readRgba(gl, width, height, region), region.width, region.height);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    // createPlayer 可能在创建上下文后初始化失败；该画布仍只属于本次导出。
    gl ??= canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
