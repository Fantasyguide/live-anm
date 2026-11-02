import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

async function fixture(t, { build = true, force = false, base } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'anm server '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'cli'));
  await copyFile(new URL('../cli/render-server.js', import.meta.url), path.join(dir, 'cli/server.mjs'));
  if (build) {
    await mkdir(path.join(dir, 'dist/assets'), { recursive: true });
    await writeFile(path.join(dir, 'dist/agent.html'), '<!doctype html><p>agent</p>');
    await writeFile(path.join(dir, 'dist/assets/agent.js'), 'window.agent = true;');
  }
  const inputPath = path.join(dir, 'input with spaces.anm');
  await writeFile(inputPath, Buffer.from([0, 1, 255]));
  const outDir = path.join(dir, 'render output');
  const { startRenderServer } = await import(pathToFileURL(path.join(dir, 'cli/server.mjs')));
  const start = () => startRenderServer({ inputPath, outDir, force, base });
  return { dir, inputPath, outDir, start };
}

async function post(server, name, data, origin = new URL(server.url).origin) {
  return fetch(new URL(`artifacts/${name}`, server.url), {
    method: 'POST', headers: { Origin: origin }, body: data,
  });
}

test('serves only the agent assets and explicit input through a custom base', async (t) => {
  const fixtureData = await fixture(t, { base: '/custom path/' });
  const server = await fixtureData.start();
  t.after(server.close);
  assert.match(server.url, /\/custom%20path\/agent\.html$/);
  assert.match(await (await fetch(server.url)).text(), /<p>agent<\/p>/);
  const asset = await fetch(new URL('assets/agent.js', server.url));
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), 'window.agent = true;');
  assert.deepEqual(Buffer.from(await (await fetch(new URL('input.anm', server.url))).arrayBuffer()), Buffer.from([0, 1, 255]));
  assert.equal((await fetch(new URL('../input with spaces.anm', server.url))).status, 404);
  assert.equal((await fetch(new URL('assets/%2e%2e%2fagent.html', server.url))).status, 404);
});

test('saves binary output and refuses overwrite by default', async (t) => {
  const { start, outDir } = await fixture(t);
  const server = await start();
  t.after(server.close);
  const response = await post(server, 'image%20one.png', Buffer.from([8, 0, 255]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { path: path.join(outDir, 'image one.png'), bytes: 3 }, warnings: [] });
  assert.deepEqual(await readFile(path.join(outDir, 'image one.png')), Buffer.from([8, 0, 255]));
  const duplicate = await post(server, 'image%20one.png', 'replace');
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'OUTPUT_EXISTS');
  assert.deepEqual(await readFile(path.join(outDir, 'image one.png')), Buffer.from([8, 0, 255]));
});

test('force permits replacement, while filename and origin checks constrain writes', async (t) => {
  const { start, outDir, dir } = await fixture(t, { force: true });
  const server = await start();
  t.after(server.close);
  assert.equal((await post(server, 'out.gif', 'first')).status, 200);
  assert.equal((await post(server, 'out.gif', 'last')).status, 200);
  assert.equal(await readFile(path.join(outDir, 'out.gif'), 'utf8'), 'last');
  assert.equal((await post(server, '..%2fescape.png', 'bad')).status, 400);
  assert.equal((await post(server, 'nested%5cescape.png', 'bad')).status, 400);
  assert.equal((await post(server, 'out.txt', 'bad')).status, 400);
  assert.equal((await post(server, 'origin.png', 'bad', 'https://example.com')).status, 403);
  await assert.rejects(readFile(path.join(dir, 'escape.png')), { code: 'ENOENT' });
});

test('reports missing build without building or listening', async (t) => {
  const { start } = await fixture(t, { build: false });
  await assert.rejects(start, (error) => error.code === 'ASSETS_NOT_BUILT' && /npm run build/.test(error.message));
});

test('rejects a base that would turn the returned URL into another origin', async (t) => {
  const { start } = await fixture(t, { base: '//example.com/' });
  await assert.rejects(start, { code: 'USAGE' });
});
