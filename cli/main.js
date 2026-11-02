import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { inspectAnm, dumpScript, replaceScript, runScript } from './core.js';

const HELP = `Usage: node bin/anm.mjs <command> <input.anm> [options]

Commands:
  inspect input.anm [--json]
  script dump input.anm --script N [--syntax thanm|raw] [-o script.txt]
  script replace input.anm --script N --source script.txt -o edited.anm
  run input.anm --script N --steps N [--position x,y[,z]]
  serve input.anm --out-dir DIR [--port 0] [--base /live-anm/]
  render input.anm --script N -o frame.png [--frame 0]
  gif input.anm --script N -o animation.gif [--duration 3] [--fps 20] [--once]
  sprite input.anm --sprite N -o sprite.png

Options:
  --json                  Emit one JSON result object
  -h, --help              Show command usage
  -o, --output PATH       Save output (required for replace/render/gif/sprite)
  --force                 Allow overwriting an existing output
  --syntax thanm|raw      Script syntax; default thanm
  --width 640 --height 480  Animation canvas dimensions
  --position x,y[,z]      Run: origin; animation: canvas center
  --crop x,y,width,height Crop animation after rendering
  --playwright-module PATH  Existing Node Playwright package directory or entry
  --browser-path PATH    Existing browser executable (exclusive with --channel)
  --channel chrome|msedge Use an installed browser channel
  --base /live-anm/       Match the built agent page base path

Script and sprite numbers are global zero-based indices, not raw IDs.
Render frame 0 executes one manager step; run --steps 0 executes none.
No Playwright, browser or build assets are installed automatically.
`;

const options = {
  help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' }, force: { type: 'boolean' },
  output: { type: 'string', short: 'o' }, script: { type: 'string' }, sprite: { type: 'string' },
  source: { type: 'string' }, syntax: { type: 'string' }, steps: { type: 'string' }, position: { type: 'string' },
  'out-dir': { type: 'string' }, port: { type: 'string' }, base: { type: 'string' },
  frame: { type: 'string' }, duration: { type: 'string' }, fps: { type: 'string' }, once: { type: 'boolean' },
  width: { type: 'string' }, height: { type: 'string' }, crop: { type: 'string' },
  'playwright-module': { type: 'string' }, 'browser-path': { type: 'string' }, channel: { type: 'string' },
};
const common = ['help', 'json'];
const driver = ['output', 'force', 'playwright-module', 'browser-path', 'channel', 'base'];
const animation = ['script', 'width', 'height', 'position', 'crop'];
const allowed = {
  inspect: [], 'script dump': ['script', 'syntax', 'output', 'force'],
  'script replace': ['script', 'syntax', 'source', 'output', 'force'],
  run: ['script', 'steps', 'position'], serve: ['out-dir', 'port', 'base', 'force'],
  render: [...driver, ...animation, 'frame'], gif: [...driver, ...animation, 'duration', 'fps', 'once'],
  sprite: [...driver, 'sprite'],
};

function failure(code, message, details, exitCode = 1) {
  return Object.assign(new Error(message), { code, details, exitCode });
}
const usage = message => failure('USAGE', message, undefined, 2);

function required(values, key) {
  if (typeof values[key] !== 'string' || !values[key].trim()) throw usage(`--${key} is required.`);
  return values[key];
}

function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw usage(`${name} must be an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw usage(`${name} must be between ${min} and ${max}.`);
  return number;
}

function position(value) {
  const parts = value.split(',');
  if (parts.length < 2 || parts.length > 3 || parts.some(v => !v.trim() || !Number.isFinite(Number(v)))) {
    throw usage('--position must be x,y or x,y,z with finite numbers.');
  }
  return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2] ?? 0) };
}

function crop(value, width, height) {
  const parts = value.split(',');
  if (parts.length !== 4) throw usage('--crop must be x,y,width,height.');
  const [x, y, w, h] = parts.map((v, i) => integer(v.trim(), '--crop', i < 2 ? 0 : 1));
  if (x + w > width || y + h > height) throw usage('--crop must fit within the canvas.');
  return { x, y, width: w, height: h };
}

async function inputBytes(path) {
  try { return await readFile(path); }
  catch (cause) { throw failure('INPUT_READ_FAILED', `Cannot read ${path}: ${cause.message}`); }
}

async function save(path, data, force) {
  try { await writeFile(path, data, { flag: force ? 'w' : 'wx' }); }
  catch (cause) {
    throw failure(cause.code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_WRITE_FAILED', `Cannot write ${path}: ${cause.message}`);
  }
  return { path, bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength };
}

function describe(data) {
  if (data.path) return `${data.path} (${data.bytes} bytes)`;
  if (data.url) return `Ready: ${data.url}\nOutput directory: ${data.outDir}`;
  return JSON.stringify(data, null, 2);
}

/** Parse and execute a repository-local command; process ownership stays in bin. */
export async function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  let json = argv.includes('--json');
  let fallbackCode = 'USAGE';
  const emit = (data, warnings = []) => {
    if (json) stdout.write(`${JSON.stringify({ ok: true, data, warnings })}\n`);
    else {
      stdout.write(`${describe(data)}\n`);
      for (const warning of warnings) stderr.write(`Warning: ${warning.message ?? warning.reason ?? String(warning)}\n`);
    }
  };
  try {
    let parsed;
    try { parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true, tokens: true }); }
    catch (cause) { throw usage(cause.message); }
    const { values, positionals, tokens } = parsed;
    json = values.json ?? false;
    const command = positionals[0] === 'script' ? `script ${positionals[1] ?? ''}` : positionals[0];
    if (!command && values.help) {
      if (json) emit({ help: HELP }); else stdout.write(HELP);
      return 0;
    }
    if (!Object.hasOwn(allowed, command)) throw usage(`Unknown or missing command: ${command ?? ''}. Use --help for usage.`);
    const permitted = new Set([...common, ...allowed[command]]);
    for (const token of tokens) {
      if (token.kind === 'option' && !permitted.has(token.name)) throw usage(`--${token.name} is not available for ${command}.`);
    }
    if (values.help) {
      if (json) emit({ help: HELP }); else stdout.write(HELP);
      return 0;
    }
    const expected = command.startsWith('script ') ? 3 : 2;
    if (positionals.length !== expected) throw usage(`${command} requires exactly one input ANM path.`);
    const inputPath = resolve(cwd, positionals.at(-1));
    const outputPath = values.output === undefined ? undefined : resolve(cwd, required(values, 'output'));
    const force = values.force ?? false;
    const syntax = values.syntax ?? 'thanm';
    if (syntax !== 'thanm' && syntax !== 'raw') throw usage('--syntax must be thanm or raw.');
    const scriptIndex = permitted.has('script') ? integer(required(values, 'script'), '--script') : undefined;
    const spriteIndex = permitted.has('sprite') ? integer(required(values, 'sprite'), '--sprite') : undefined;

    if (command === 'inspect') {
      fallbackCode = 'ANM_PARSE_FAILED';
      emit(inspectAnm(await inputBytes(inputPath)));
    } else if (command === 'script dump') {
      fallbackCode = 'ANM_PARSE_FAILED';
      const data = dumpScript(await inputBytes(inputPath), scriptIndex, syntax);
      if (outputPath) emit({ ...data, ...await save(outputPath, `${data.text}\n`, force) });
      else if (json) emit(data);
      else stdout.write(`${data.text}\n`);
    } else if (command === 'script replace') {
      required(values, 'output');
      const sourcePath = resolve(cwd, required(values, 'source'));
      if (outputPath === inputPath) throw usage('Replace output must be a different resolved path from the input.');
      fallbackCode = 'ASSEMBLY_FAILED';
      const bytes = await inputBytes(inputPath);
      const source = (await inputBytes(sourcePath)).toString('utf8');
      const result = replaceScript(bytes, scriptIndex, source, syntax);
      if (result.errors.length) throw failure('ASSEMBLY_FAILED', 'Script assembly failed; output was not written.', { errors: result.errors });
      emit({ scriptIndex, ...await save(outputPath, result.bytes, force) });
    } else if (command === 'run') {
      const steps = integer(required(values, 'steps'), '--steps');
      const entityPos = values.position === undefined ? { x: 0, y: 0, z: 0 } : position(values.position);
      fallbackCode = 'RUN_FAILED';
      const { warnings, ...data } = runScript(await inputBytes(inputPath), scriptIndex, { steps, position: entityPos });
      emit(data, warnings);
    } else {
      const base = values.base ?? '/live-anm/';
      if (!base.startsWith('/') || base.startsWith('//') || !base.endsWith('/') || /[?#\\]/.test(base) || base.split('/').some(p => p === '.' || p === '..')) {
        throw usage('--base must be an absolute URL pathname ending with /, such as /live-anm/.');
      }
      if (command === 'serve') {
        const outDir = resolve(cwd, required(values, 'out-dir'));
        const port = integer(values.port ?? '0', '--port', 0, 65535);
        fallbackCode = 'RENDER_FAILED';
        const { startRenderServer } = await import('./render-server.js');
        const server = await startRenderServer({ inputPath, outDir, port, force, base });
        const stop = async signal => {
          process.removeListener('SIGINT', onInterrupt);
          process.removeListener('SIGTERM', onTerminate);
          try { await server.close(); }
          catch (cause) { stderr.write(`Cannot close render server: ${cause.message}\n`); }
          process.exitCode = signal === 'SIGINT' ? 130 : 143;
        };
        const onInterrupt = () => { void stop('SIGINT'); };
        const onTerminate = () => { void stop('SIGTERM'); };
        process.once('SIGINT', onInterrupt);
        process.once('SIGTERM', onTerminate);
        emit({ url: server.url, outDir: server.outDir });
      } else {
        required(values, 'output');
        const extension = command === 'gif' ? '.gif' : '.png';
        if (extname(outputPath).toLowerCase() !== extension) throw usage(`${command} output must have the ${extension} extension.`);
        if (values['browser-path'] !== undefined && values.channel !== undefined) throw usage('--browser-path and --channel are mutually exclusive.');
        if (values.channel !== undefined && !['chrome', 'msedge'].includes(values.channel)) throw usage('--channel must be chrome or msedge.');
        const renderOptions = command === 'sprite' ? { spriteIndex } : {
          scriptIndex,
          width: integer(values.width ?? '640', '--width', 1, 65535),
          height: integer(values.height ?? '480', '--height', 1, 65535),
        };
        if (command !== 'sprite') {
          if (values.position !== undefined) renderOptions.position = position(values.position);
          if (values.crop !== undefined) renderOptions.crop = crop(values.crop, renderOptions.width, renderOptions.height);
        }
        if (command === 'render') renderOptions.frame = integer(values.frame ?? '0', '--frame');
        if (command === 'gif') {
          const duration = Number(values.duration ?? '3');
          if (!Number.isFinite(duration) || duration < 0.1 || duration > 30) throw usage('--duration must be between 0.1 and 30 seconds.');
          const fps = integer(values.fps ?? '20', '--fps');
          if (![10, 20, 30].includes(fps)) throw usage('--fps must be 10, 20 or 30.');
          Object.assign(renderOptions, { duration, fps, loop: !values.once });
        }
        // Validate selection before creating a server or browser.
        const info = inspectAnm(await inputBytes(inputPath));
        const selection = command === 'sprite' ? info.sprites[spriteIndex] : info.scripts[scriptIndex];
        if (!selection) throw usage(`No ${command === 'sprite' ? 'sprite' : 'script'} at that global index.`);
        fallbackCode = 'RENDER_FAILED';
        const { renderWithBrowser } = await import('./browser-runner.js');
        const result = await renderWithBrowser({
          method: { render: 'renderFrame', gif: 'exportGif', sprite: 'exportSprite' }[command],
          inputPath, outputPath, renderOptions, cwd, force, base,
          ...(values['playwright-module'] === undefined ? {} : { playwrightModule: resolve(cwd, required(values, 'playwright-module')) }),
          ...(values['browser-path'] === undefined ? {} : { browserPath: resolve(cwd, required(values, 'browser-path')) }),
          ...(values.channel === undefined ? {} : { channel: values.channel }),
        });
        if (!result.ok) throw failure(result.error.code, result.error.message, result.error.details, result.error.code === 'USAGE' ? 2 : 1);
        emit(result.data, result.warnings ?? []);
      }
    }
    return 0;
  } catch (cause) {
    const code = cause.code ?? fallbackCode;
    const error = { code, message: cause.message, ...(cause.details === undefined ? {} : { details: cause.details }) };
    if (json) stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
    else stderr.write(`${error.code}: ${error.message}\n${error.details ? `${JSON.stringify(error.details)}\n` : ''}`);
    return cause.exitCode ?? (code === 'USAGE' ? 2 : 1);
  }
}
