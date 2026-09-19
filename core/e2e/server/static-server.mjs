#!/usr/bin/env node
/**
 * Minimal static file server for the e2e suite. Serves the published build
 * output (`dist/`), the test harness pages (`e2e/pages/`) and the fixtures
 * (`e2e/fixtures/`) from one origin, so tests exercise the artifact that
 * actually ships - not the Vite dev server.
 *
 *   /dist/...      -> core/dist
 *   /fixtures/...  -> core/e2e/fixtures
 *   /...           -> core/e2e/pages
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(__dirname, '..', '..');

const ROUTES = [
  { prefix: '/dist/', root: path.join(CORE_ROOT, 'dist') },
  { prefix: '/fixtures/', root: path.join(CORE_ROOT, 'e2e', 'fixtures') },
  { prefix: '/', root: path.join(CORE_ROOT, 'e2e', 'pages') },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.mp3': 'audio/mpeg',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
  '.map': 'application/json; charset=utf-8',
};

function resolveFile(url) {
  const clean = url.split('?')[0];
  for (const route of ROUTES) {
    if (clean.startsWith(route.prefix) || route.prefix === '/') {
      const rel = route.prefix === '/' ? clean : clean.slice(route.prefix.length - 1);
      const filePath = path.join(route.root, decodeURIComponent(rel));
      if (!filePath.startsWith(route.root)) continue; // no path traversal
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return filePath;
      }
    }
  }
  return null;
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = req.url ?? '/';
    const filePath = url === '/' ? null : resolveFile(url);

    if (!filePath) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME[ext] ?? 'application/octet-stream';
    const baseHeaders = {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
    };

    // <video> seeking needs real byte-range support - without a 206 response
    // Chrome fails the seek silently and currentTime snaps back to 0.
    const { size } = fs.statSync(filePath);
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const end = match?.[2] ? parseInt(match[2], 10) : size - 1;
      res.writeHead(206, {
        ...baseHeaders,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...baseHeaders, 'content-length': size });
    fs.createReadStream(filePath).pipe(res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4173);
  createServer().listen(port, () => {
    console.log(`e2e static server listening on http://localhost:${port}`);
  });
}
