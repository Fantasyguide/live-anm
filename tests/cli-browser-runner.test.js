import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPlaywright, renderWithBrowser } from '../cli/browser-runner.js';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'anm playwright '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('loads explicitly supplied external CommonJS and ESM entry files', async (t) => {
  const dir = await tempDir(t);
  const cjs = path.join(dir, 'external.cjs');
  const esm = path.join(dir, 'external.mjs');
  await writeFile(cjs, 'module.exports = {chromium: {launch: async () => "cjs-loaded"}};');
  await writeFile(esm, 'export const chromium = {launch: async () => "esm-loaded"};');
  assert.equal(await (await loadPlaywright({ playwrightModule: cjs })).chromium.launch(), 'cjs-loaded');
  assert.equal(await (await loadPlaywright({ playwrightModule: esm })).chromium.launch(), 'esm-loaded');
});

test('resolves an external module directory and packages from caller cwd', async (t) => {
  const dir = await tempDir(t);
  const moduleDir = path.join(dir, 'node_modules/playwright-core');
  await mkdir(moduleDir, { recursive: true });
  await writeFile(path.join(moduleDir, 'package.json'), '{"main":"index.cjs"}');
  await writeFile(path.join(moduleDir, 'index.cjs'), 'module.exports = {chromium: {launch: async () => "resolved"}};');
  assert.equal(await (await loadPlaywright({ cwd: dir })).chromium.launch(), 'resolved');
  assert.equal(await (await loadPlaywright({ playwrightModule: moduleDir })).chromium.launch(), 'resolved');
});

test('missing or incompatible modules give actionable browser errors', async (t) => {
  const dir = await tempDir(t);
  const incompatible = path.join(dir, 'not-playwright.mjs');
  await writeFile(incompatible, 'export default {chromium: {}};');
  for (const options of [{ cwd: dir }, { playwrightModule: path.join(dir, 'missing') }, { playwrightModule: incompatible }]) {
    await assert.rejects(loadPlaywright(options), (error) => error.code === 'BROWSER_UNAVAILABLE' && /--playwright-module/.test(error.message));
  }
});

test('validates conflicting browser selectors before loading external code', async (t) => {
  const dir = await tempDir(t);
  const modulePath = path.join(dir, 'must-not-load.mjs');
  await writeFile(modulePath, 'throw new Error("external module executed");');
  await assert.rejects(renderWithBrowser({
    method: 'renderFrame', inputPath: 'unused.anm', outputPath: 'unused.png',
    playwrightModule: modulePath, browserPath: '/browser', channel: 'chrome',
  }), (error) => error.code === 'USAGE' && /mutually exclusive/.test(error.message));
});
