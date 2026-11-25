#!/usr/bin/env node
/**
 * Minimal static server for the built bundle, used by Playwright only.
 *
 * Vite's preview server is the right tool for humans; a 40-line server is the right tool for CI,
 * because it cannot read config, watch files or negotiate ports — it either serves `dist` or exits.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = resolve('dist');

if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/index.html is missing: run `npm run build` first');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const safe = normalize(url).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, safe === '/' ? 'index.html' : safe);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Single-page app: unknown paths fall back to the shell.
    file = join(root, 'index.html');
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
