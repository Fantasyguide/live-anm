import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildAnmFile } from '../src/format/anm-v8-write.js';
import { parseAnm } from '../src/format/anm-v8.js';

const bin = fileURLToPath(new URL('../bin/anm.mjs', import.meta.url));
function cli(cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
}
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'anm-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = buildAnmFile({ entries: [{ hasTexture: false, scripts: [
    { id: -7, instructions: [{ time: 0, opcode: 0, paramMask: 0, args: [] }] },
    { id: 42, instructions: [{ time: 0, opcode: 3, paramMask: 0, args: [] }] },
  ] }] });
  await writeFile(join(dir, 'input.anm'), bytes);
  return { dir, bytes };
}

test('CLI JSON inspection and raw/thanm dump select the global script', async t => {
  const { dir } = await setup(t);
  const inspected = cli(dir, 'inspect', 'input.anm', '--json');
  assert.equal(inspected.status, 0, inspected.stderr);
  const result = JSON.parse(inspected.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.data.scripts[1].id, 42);
  assert.deepEqual(result.warnings, []);
  const raw = cli(dir, 'script', 'dump', 'input.anm', '--script', '1', '--syntax', 'raw');
  assert.equal(raw.status, 0, raw.stderr);
  assert.equal(raw.stdout, '0: stop();\n');
  const thanm = cli(dir, 'script', 'dump', 'input.anm', '--script', '1', '--json');
  assert.match(JSON.parse(thanm.stdout).data.text, /stop\(\);/);
  const saved = cli(dir, 'script', 'dump', 'input.anm', '--script', '1', '-o', 'script.txt');
  assert.equal(saved.status, 0, saved.stderr);
  assert.match(await readFile(join(dir, 'script.txt'), 'utf8'), /stop\(\);/);
});

test('replace refuses invalid source, existing output and input overwrite', async t => {
  const { dir, bytes } = await setup(t);
  await writeFile(join(dir, 'bad.txt'), 'bad syntax');
  const bad = cli(dir, 'script', 'replace', 'input.anm', '--script', '1', '--source', 'bad.txt', '-o', 'new.anm', '--json');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).error.code, 'ASSEMBLY_FAILED');
  await assert.rejects(access(join(dir, 'new.anm')));
  await writeFile(join(dir, 'source.txt'), '0:\nalpha(128);\nstop();');
  await writeFile(join(dir, 'new.anm'), 'existing');
  const args = ['script', 'replace', 'input.anm', '--script', '1', '--source', 'source.txt', '-o', 'new.anm', '--json'];
  const exists = cli(dir, ...args);
  assert.equal(exists.status, 1);
  assert.equal(JSON.parse(exists.stdout).error.code, 'OUTPUT_EXISTS');
  assert.equal(await readFile(join(dir, 'new.anm'), 'utf8'), 'existing');
  const forced = cli(dir, ...args, '--force');
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(parseAnm(await readFile(join(dir, 'new.anm'))).entries[0].scripts[1].instructions[0].opcode, 403);
  const same = cli(dir, ...args.slice(0, -3), '-o', './input.anm', '--force', '--json');
  assert.equal(same.status, 2);
  assert.equal(JSON.parse(same.stdout).error.code, 'USAGE');
  assert.deepEqual(await readFile(join(dir, 'input.anm')), Buffer.from(bytes));
});

test('strict flags, help and missing files use documented exit codes', async t => {
  const { dir } = await setup(t);
  assert.equal(cli(dir, '--help').status, 0);
  for (const args of [
    ['inspect', 'input.anm', '--bogus', '--json'],
    ['run', 'input.anm', '--script', '0', '--steps', '-1', '--json'],
    ['render', 'input.anm', '--script', '0', '--width', '0', '-o', 'x.png', '--json'],
    ['render', 'input.anm', '--script', '0', '--width', '65536', '-o', 'x.png', '--json'],
    ['sprite', 'input.anm', '--sprite', '0', '-o', 'x.png', '--browser-path', '/bin/no', '--channel', 'chrome', '--json'],
  ]) {
    const result = cli(dir, ...args);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, 'USAGE');
  }
  const missing = cli(dir, 'inspect', 'missing.anm', '--json');
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).error.code, 'INPUT_READ_FAILED');
});

test('run JSON uses explicit VM fields and reports no execution for steps zero', async t => {
  const { dir } = await setup(t);
  const result = cli(dir, 'run', 'input.anm', '--script', '1', '--steps', '0', '--json');
  assert.equal(result.status, 0, result.stderr);
  const { data } = JSON.parse(result.stdout);
  assert.equal(data.root.pc, 0);
  assert.equal(data.root.time, 0);
  assert.equal(data.root.alive, true);
  assert.equal(data.vms.length, 1);
  assert.equal('_instructions' in data.root, false);
});

test('render preserves browser-unavailable errors without starting a browser', async t => {
  const { dir } = await setup(t);
  const result = cli(dir, 'render', 'input.anm', '--script', '0', '-o', 'frame.png', '--playwright-module', join(dir, 'missing-playwright'), '--json');
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'BROWSER_UNAVAILABLE');
  await assert.rejects(access(join(dir, 'frame.png')));
});
