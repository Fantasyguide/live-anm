import { parseAnm } from '@engine/format/anm-v8.js';
import { decodeThtx } from '@engine/format/thtx.js';
import { flattenFile } from '@engine/host/manager.js';
import { captureRegion, canvasToPng } from './capture.js';
import { exportAnmFrame } from './frame-export.js';
import { exportAnmGif } from './gif-export.js';
import { createGifPlan } from './gif-plan.js';

const status = document.getElementById('status');
let bytes;
let parsed;
let loaded;

function error(code, message) {
  return Object.assign(new Error(message), { code });
}

function failure(cause, fallback = 'RENDER_FAILED') {
  return { ok: false, error: {
    code: cause.code ?? fallback,
    message: cause.message ?? String(cause),
    ...(cause.details === undefined ? {} : { details: cause.details }),
  } };
}

// 只解析目录和指令；Sprite 导出不触发所有 entry 的贴图解码。
const ready = (async () => {
  try {
    let response;
    try {
      response = await fetch(new URL('input.anm', location.href));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      throw error('INPUT_READ_FAILED', `无法读取 ANM：${cause.message}`);
    }
    try { parsed = parseAnm(bytes); }
    catch (cause) { throw error('ANM_PARSE_FAILED', cause.message); }
    const data = {
      entries: parsed.entries.length,
      scripts: parsed.entries.reduce((sum, entry) => sum + entry.scripts.length, 0),
      sprites: parsed.entries.reduce((sum, entry) => sum + entry.sprites.length, 0),
    };
    if (status) status.textContent = 'ANM 已就绪，可通过 window.liveAnm 导出图片。';
    return { ok: true, data, warnings: [] };
  } catch (cause) {
    if (status) status.textContent = cause.message;
    return failure(cause);
  }
})();

function optionsObject(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw error('USAGE', '参数必须是对象');
  return options;
}

function outputName(output, extension) {
  if (typeof output !== 'string' || !output || /[\/\\\0]/.test(output) ||
      !output.toLowerCase().endsWith(`.${extension}`)) {
    throw error('USAGE', `output 必须是单个 .${extension} 文件名`);
  }
  return output;
}

function indexInRange(index, count, name) {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw error('USAGE', `${name} 必须是有效的全局序号（共 ${count} 条）`);
  }
}

function animationOptions(options) {
  const { width = 640, height = 480, crop, position } = options;
  let region;
  try { region = captureRegion(width, height, crop); }
  catch (cause) { throw error('USAGE', cause.message); }
  const entityPos = position === undefined ? { x: width / 2, y: height / 2, z: 0 } : {
    x: position?.x, y: position?.y, z: position?.z ?? 0,
  };
  if (!Object.values(entityPos).every(Number.isFinite)) throw error('USAGE', 'position 的 x、y、z 必须是有限数值');
  return { width, height, crop: region, entityPos };
}

function animationFile() {
  loaded ??= flattenFile(bytes, parsed);
  return loaded;
}

async function save(blob, output, metadata, warnings = []) {
  let response;
  let result;
  try {
    response = await fetch(new URL(`artifacts/${encodeURIComponent(output)}`, location.href), {
      method: 'POST', headers: { 'Content-Type': blob.type }, body: blob,
    });
    result = await response.json();
  } catch (cause) {
    throw error('OUTPUT_WRITE_FAILED', `保存图片失败：${cause.message}`);
  }
  if (!result.ok) return result;
  if (!response.ok) throw error('OUTPUT_WRITE_FAILED', `保存图片失败：HTTP ${response.status}`);
  return { ok: true, data: { ...result.data, ...metadata }, warnings: [...(result.warnings ?? []), ...warnings] };
}

async function withInput(action) {
  const input = await ready;
  if (!input.ok) return input;
  try { return await action(input.data); }
  catch (cause) { return failure(cause); }
}

async function renderFrame(request = {}) {
  return withInput(async (info) => {
    const options = optionsObject(request);
    const output = outputName(options.output, 'png');
    indexInRange(options.scriptIndex, info.scripts, 'scriptIndex');
    const { frame = 0 } = options;
    if (!Number.isInteger(frame) || frame < 0) throw error('USAGE', 'frame 必须是非负整数');
    const render = animationOptions(options);
    let warnings = [];
    const png = await exportAnmFrame(animationFile(), options.scriptIndex, {
      ...render, frame, onWarnings: (value) => { warnings = value; },
    });
    return save(new Blob([png], { type: 'image/png' }), output, {
      mimeType: 'image/png', width: render.crop.width, height: render.crop.height,
    }, warnings);
  });
}

async function exportGif(request = {}) {
  return withInput(async (info) => {
    const options = optionsObject(request);
    const output = outputName(options.output, 'gif');
    indexInRange(options.scriptIndex, info.scripts, 'scriptIndex');
    const { duration = 3, fps = 20, loop = true } = options;
    if (typeof loop !== 'boolean') throw error('USAGE', 'loop 必须是布尔值');
    const render = { ...animationOptions(options), duration, fps, loop };
    let plan;
    try { plan = createGifPlan(render); }
    catch (cause) { throw error('USAGE', cause.message); }
    let warnings = [];
    const gif = await exportAnmGif(animationFile(), options.scriptIndex, {
      ...render, onWarnings: (value) => { warnings = value; },
    });
    return save(new Blob([gif], { type: 'image/gif' }), output, {
      mimeType: 'image/gif', width: plan.crop.width, height: plan.crop.height,
      frames: plan.frames.length, duration: plan.frames.reduce((sum, frame) => sum + frame.delay, 0) / 1000,
    }, warnings);
  });
}

async function exportSprite(request = {}) {
  return withInput(async (info) => {
    const options = optionsObject(request);
    const output = outputName(options.output, 'png');
    indexInRange(options.spriteIndex, info.sprites, 'spriteIndex');
    let remaining = options.spriteIndex;
    let entry;
    let sprite;
    for (const current of parsed.entries) {
      if (remaining < current.sprites.length) { entry = current; sprite = current.sprites[remaining]; break; }
      remaining -= current.sprites.length;
    }
    if (!entry.thtxRaw) throw new Error('这个 Sprite 所属的 entry 没有内嵌图片');
    if (![sprite.x, sprite.y, sprite.w, sprite.h].every(Number.isFinite) || sprite.w <= 0 || sprite.h <= 0) {
      throw new Error('Sprite 坐标必须有效，宽高必须大于 0');
    }
    const width = Math.ceil(sprite.w);
    const height = Math.ceil(sprite.h);
    captureRegion(width, height);
    const texture = decodeThtx(entry.thtxRaw, 0);
    if (!texture.width || !texture.height) throw new Error('Sprite 所属的贴图尺寸为空');
    const atlas = document.createElement('canvas');
    atlas.width = texture.width;
    atlas.height = texture.height;
    const ctx = atlas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建 Sprite 画布');
    const image = ctx.createImageData(texture.width, texture.height);
    image.data.set(texture.rgba);
    ctx.putImageData(image, 0, 0);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const target = canvas.getContext('2d');
    if (!target) throw new Error('当前浏览器无法创建 Sprite 画布');
    target.imageSmoothingEnabled = false;
    // Canvas 按原切片范围裁切；贴图外的区域自然保留透明。
    target.drawImage(atlas, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, width, height);
    return save(await canvasToPng(canvas), output, { mimeType: 'image/png', width, height });
  });
}

window.liveAnm = { ready, renderFrame, exportGif, exportSprite };
