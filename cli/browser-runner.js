import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startRenderServer } from './render-server.js';

function failure(code, message, details) {
  return Object.assign(new Error(message), { code, ...(details && { details }), ...(code === 'USAGE' && { exitCode: 2 }) });
}

/** Load an existing external Node Playwright package, without installing it. */
export async function loadPlaywright({ playwrightModule, cwd = process.cwd() } = {}) {
  if (playwrightModule && !path.isAbsolute(playwrightModule)) {
    throw failure('USAGE', '--playwright-module must be an absolute module directory or entry file.');
  }
  const resolve = createRequire(path.join(path.resolve(cwd), '__anm_cli__.cjs')).resolve;
  let entry;
  let reason;
  for (const candidate of playwrightModule ? [playwrightModule] : ['playwright', 'playwright-core']) {
    try {
      entry = resolve(candidate);
      break;
    } catch (error) {
      reason = error.message;
    }
  }
  if (!entry) {
    throw failure('BROWSER_UNAVAILABLE', 'Node Playwright was not found. Set --playwright-module to an existing absolute package directory or entry file.', { reason });
  }
  try {
    const loaded = await import(pathToFileURL(entry).href);
    const playwright = typeof loaded.chromium?.launch === 'function' ? loaded : loaded.default;
    if (typeof playwright?.chromium?.launch !== 'function') throw new Error('The module does not expose chromium.launch.');
    return playwright;
  } catch (error) {
    throw failure('BROWSER_UNAVAILABLE', 'Cannot load Node Playwright with chromium.launch. Set --playwright-module to an existing compatible Node package.', { reason: error.message });
  }
}

/** Invoke the public browser API in a browser and server owned by this call. */
export async function renderWithBrowser({
  method, inputPath, outputPath, renderOptions = {}, playwrightModule,
  browserPath, channel, base = '/live-anm/', force = false, cwd = process.cwd(),
}) {
  if (!['renderFrame', 'exportGif', 'exportSprite'].includes(method)) throw failure('USAGE', 'Unknown browser render method.');
  if (browserPath && channel) throw failure('USAGE', '--browser-path and --channel are mutually exclusive.');
  if (channel && !['chrome', 'msedge'].includes(channel)) throw failure('USAGE', '--channel must be chrome or msedge.');
  if (typeof outputPath !== 'string' || path.extname(outputPath).toLowerCase() !== (method === 'exportGif' ? '.gif' : '.png')) {
    throw failure('USAGE', `Output must have a ${method === 'exportGif' ? '.gif' : '.png'} extension.`);
  }
  const destination = path.resolve(cwd, outputPath);
  if (!force) {
    try {
      await stat(destination);
      throw failure('OUTPUT_EXISTS', `Output already exists: ${destination}. Use --force to overwrite.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const playwright = await loadPlaywright({ playwrightModule, cwd });
  let server;
  let browser;
  try {
    server = await startRenderServer({ inputPath: path.resolve(cwd, inputPath), outDir: path.dirname(destination), base, force });
    try {
      browser = await playwright.chromium.launch({
        headless: true,
        ...(browserPath && { executablePath: path.resolve(cwd, browserPath) }),
        ...(channel && { channel }),
      });
    } catch (error) {
      throw failure('BROWSER_UNAVAILABLE', 'Cannot launch the existing browser. Set --browser-path to an installed browser or use --channel chrome|msedge; no browser is downloaded automatically.', { reason: error.message });
    }
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.evaluate(async () => { await window.liveAnm.ready; });
    return await page.evaluate(async ({ method, options }) => window.liveAnm[method](options), {
      method, options: { ...renderOptions, output: path.basename(destination) },
    });
  } catch (error) {
    if (error.code) throw error;
    throw failure('RENDER_FAILED', `Browser rendering failed: ${error.message}`);
  } finally {
    // Closing a browser also closes the page created above. These are our resources only.
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}
