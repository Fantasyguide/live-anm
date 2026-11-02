// 可选的真实渲染检查：复用现有 Playwright/浏览器，只调用页面 API。
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildAnm } from '../src/format/anm-v8-write.js';
import { loadPlaywright } from '../cli/browser-runner.js';
import { startRenderServer } from '../cli/render-server.js';

async function main() {
  const { values } = parseArgs({ options: {
    'playwright-module': { type: 'string' }, 'browser-path': { type: 'string' },
    channel: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('node scripts/smoke-agent-render.mjs [--playwright-module /existing/package] [--browser-path /existing/browser | --channel chrome|msedge]');
    return;
  }
  if (values['browser-path'] && values.channel) throw new Error('browser-path 和 channel 不能同时使用');
  if (values.channel && !['chrome', 'msedge'].includes(values.channel)) throw new Error('channel 仅支持 chrome 或 msedge');
  const sdk = await loadPlaywright({ playwrightModule: values['playwright-module'] });
  const directory = await mkdtemp(join(tmpdir(), 'live-anm-render-'));
  const inputPath = join(directory, 'synthetic.anm');
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    rgba.set(y < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 8 + x) * 4);
  }
  rgba[3] = 0;
  await writeFile(inputPath, buildAnm({
    name: 'synthetic.png', width: 8, height: 8, rgba,
    sprites: [{ x: 0, y: 0, w: 8, h: 8 }],
    scripts: [{ instructions: [
      { time: 0, opcode: 300, paramMask: 0, args: [0] },
      { time: 0, opcode: 3, paramMask: 0, args: [] },
    ] }],
  }));
  let browser;
  let server;
  try {
    server = await startRenderServer({ inputPath, outDir: directory });
    browser = await sdk.chromium.launch({ headless: true,
      ...(values['browser-path'] && { executablePath: resolve(values['browser-path']) }),
      ...(values.channel && { channel: values.channel }),
    });
    const page = await browser.newPage();
    await page.goto(server.url);
    const ready = await page.evaluate(() => window.liveAnm.ready);
    assert.equal(ready.ok, true, JSON.stringify(ready));
    const render = { scriptIndex: 0, width: 16, height: 16, position: { x: 8, y: 8 }, crop: { x: 4, y: 4, width: 8, height: 8 } };
    const requests = [
      { method: 'renderFrame', options: { ...render, frame: 0, output: 'frame.png' } },
      { method: 'exportSprite', options: { spriteIndex: 0, output: 'sprite.png' } },
      { method: 'exportGif', options: { ...render, duration: 0.1, fps: 30, output: 'animation.gif' } },
    ];
    const results = [];
    for (const request of requests) {
      const result = await page.evaluate(({ method, options }) => window.liveAnm[method](options), request);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.width, 8);
      assert.equal(result.data.height, 8);
      const bytes = [...await readFile(result.data.path)];
      const decoded = await page.evaluate(async ({ bytes, type }) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const sample = (image) => {
          canvas.width = image.displayWidth ?? image.width;
          canvas.height = image.displayHeight ?? image.height;
          ctx.drawImage(image, 0, 0);
          return { width: canvas.width, height: canvas.height,
            top: [...ctx.getImageData(3, 1, 1, 1).data], bottom: [...ctx.getImageData(3, 6, 1, 1).data],
            alpha: ctx.getImageData(0, 0, 1, 1).data[3] };
        };
        if (type === 'image/png') {
          const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }));
          try { return sample(image); } finally { image.close(); }
        }
        if (!globalThis.ImageDecoder || !await ImageDecoder.isTypeSupported(type)) return { unavailable: 'ImageDecoder GIF 支持不可用，GIF 解码验收未完成' };
        const decoder = new ImageDecoder({ data: new Uint8Array(bytes), type });
        try {
          await decoder.completed;
          await decoder.tracks.ready;
          const track = decoder.tracks.selectedTrack;
          const delays = [];
          let first;
          for (let i = 0; i < track.frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            try { delays.push(image.duration / 1000); if (!first) first = sample(image); }
            finally { image.close(); }
          }
          return { ...first, frames: track.frameCount, looping: track.repetitionCount === Infinity, delays };
        } finally { decoder.close(); }
      }, { bytes, type: result.data.mimeType });
      assert.equal(decoded.unavailable, undefined, decoded.unavailable);
      assert.equal(decoded.width, 8); assert.equal(decoded.height, 8);
      assert.deepEqual(decoded.top, [255, 0, 0, 255]);
      assert.deepEqual(decoded.bottom, [0, 0, 255, 255]);
      if (request.method === 'exportSprite') assert.equal(decoded.alpha, 0);
      if (request.method === 'exportGif') {
        assert.equal(decoded.frames, 3);
        assert.deepEqual(decoded.delays, [30, 40, 30]);
        assert.equal(decoded.looping, true);
      }
      results.push({ method: request.method, ...result.data, decoded });
    }
    console.log(JSON.stringify({ ok: true, directory, results }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code ?? 'RENDER_SMOKE_FAILED', message: error.message } }));
  process.exitCode = 1;
});
