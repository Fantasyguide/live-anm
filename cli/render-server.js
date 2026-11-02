import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const distDir = path.resolve(import.meta.dirname, '../dist');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
};

function failure(code, message, details) {
  return Object.assign(new Error(message), { code, ...(details && { details }), ...(code === 'USAGE' && { exitCode: 2 }) });
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

/** Serve one explicit ANM and the built agent page on a loopback listener. */
export async function startRenderServer({ inputPath, outDir, port = 0, force = false, base = '/live-anm/' }) {
  if (typeof base !== 'string' || !base.startsWith('/') || base.startsWith('//') || !base.endsWith('/') || /[?#\\]/.test(base)
      || base.split('/').some((part) => part === '.' || part === '..')) {
    throw failure('USAGE', 'base must be an absolute URL path ending in /, without query, hash or dot segments.');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure('USAGE', 'port must be an integer from 0 to 65535.');
  const outputDirectory = path.resolve(outDir);
  const agentPath = path.join(distDir, 'agent.html');
  try {
    if (!(await stat(agentPath)).isFile()) throw new Error('agent.html is not a file');
  } catch {
    throw failure('ASSETS_NOT_BUILT', 'Agent assets are missing. Run npm ci if needed, then npm run build before rendering.');
  }
  let input;
  try {
    input = await readFile(path.resolve(inputPath));
  } catch (error) {
    throw failure('INPUT_READ_FAILED', `Cannot read ANM input: ${error.message}`);
  }
  let origin;
  const server = http.createServer(async (request, response) => {
    try {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, origin).pathname);
      } catch {
        sendJson(response, 400, { ok: false, error: { code: 'USAGE', message: 'Invalid URL path.' } });
        return;
      }
      if (!pathname.startsWith(base)) {
        sendJson(response, 404, { ok: false, error: { code: 'USAGE', message: 'Route not found.' } });
        return;
      }
      const relative = pathname.slice(base.length);
      if (request.method === 'POST' && relative.startsWith('artifacts/')) {
        if (request.headers.origin !== origin) {
          sendJson(response, 403, { ok: false, error: { code: 'USAGE', message: 'Artifact writes require a same-origin Origin header.' } });
          return;
        }
        const name = relative.slice('artifacts/'.length);
        if (!name || /[/\\\0]/.test(name) || !/\.(png|gif)$/i.test(name)) {
          sendJson(response, 400, { ok: false, error: { code: 'USAGE', message: 'Output must be a single .png or .gif filename.' } });
          return;
        }
        const outputPath = path.join(outputDirectory, name);
        try {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const bytes = Buffer.concat(chunks);
          await mkdir(outputDirectory, { recursive: true });
          await writeFile(outputPath, bytes, { flag: force ? 'w' : 'wx' });
          sendJson(response, 200, { ok: true, data: { path: outputPath, bytes: bytes.length }, warnings: [] });
        } catch (error) {
          sendJson(response, error.code === 'EEXIST' ? 409 : 500, { ok: false, error: {
            code: error.code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_WRITE_FAILED',
            message: error.code === 'EEXIST' ? `Output already exists: ${outputPath}. Use --force to overwrite.` : `Cannot write output: ${error.message}`,
          } });
        }
        return;
      }
      if (request.method === 'GET' && relative === 'input.anm') {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.end(input);
        return;
      }
      if (request.method === 'GET' && (relative === 'agent.html' || relative.startsWith('assets/'))) {
        const target = path.resolve(distDir, relative);
        const assetsRoot = path.join(distDir, 'assets') + path.sep;
        if (relative === 'agent.html' || (target.startsWith(assetsRoot) && !relative.includes('\\'))) {
          try {
            const bytes = await readFile(target);
            response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream' });
            response.end(bytes);
            return;
          } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'EISDIR' && error.code !== 'ENOTDIR') throw error;
          }
        }
      }
      sendJson(response, 404, { ok: false, error: { code: 'USAGE', message: 'Route not found.' } });
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { ok: false, error: { code: 'RENDER_FAILED', message: error.message } });
      else response.destroy(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: new URL(`${encodeURI(base)}agent.html`, origin).href,
    outDir: outputDirectory,
    close: () => new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
