#!/usr/bin/env node
/**
 * Minimal static file server for the e2e suite. Serves the published build
 * output (`dist/`), the test harness pages (`e2e/pages/`) and the fixtures
 * (`e2e/fixtures/`) from one origin, so tests exercise the artifact that
 * actually ships - not the Vite dev server.
 *
 *   /dist/...              -> core/dist
 *   /fixtures/...          -> core/e2e/fixtures
 *   /media-chrome/...      -> core/node_modules/media-chrome/dist (devDependency,
 *                             served from disk so the media-chrome e2e gate stays
 *                             hermetic - no CDN, see ADR-0001 D3)
 *   /generated/...         -> core/e2e/.generated (bundle-media-chrome.mjs's
 *                             output - see its own header comment)
 *   /...                   -> core/e2e/pages
 *
 * Every file is read once (async, via an in-memory cache keyed by resolved
 * path) and served straight from the Buffer afterwards, including Range
 * requests. Cycle 2's diagnosis (result-cycle2.md) found the previous
 * version's per-request fs.existsSync/statSync/createReadStream calls are
 * synchronous - they block this single Node process's event loop, which is
 * shared by every one of Playwright's parallel workers. Under the request
 * bursts a page load produces (a couple dozen files fetched at once), that
 * blocking was long enough to stall *other* workers' in-flight requests by
 * seconds, cascading into unrelated spec timeouts. Nothing here does disk
 * I/O off the async path, so a burst on one route can no longer stall a
 * request on another.
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handleLiveRoute } from './live-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES_ROOT = path.join(CORE_ROOT, 'e2e', 'fixtures');

const ROUTES = [
  { prefix: '/dist/', root: path.join(CORE_ROOT, 'dist') },
  { prefix: '/fixtures/', root: path.join(CORE_ROOT, 'e2e', 'fixtures') },
  { prefix: '/media-chrome/', root: path.join(CORE_ROOT, 'node_modules', 'media-chrome', 'dist') },
  { prefix: '/generated/', root: path.join(CORE_ROOT, 'e2e', '.generated') },
  { prefix: '/', root: path.join(CORE_ROOT, 'e2e', 'pages') },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  // The published UMD entries (dist/*.umd.cjs) - cycle 3, defect 5's plain
  // <script src="...dist/ultra-media-core.umd.cjs"> e2e case needs a real
  // JS content-type; without an entry here this fell back to
  // application/octet-stream.
  '.cjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.mp3': 'audio/mpeg',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
  '.map': 'application/json; charset=utf-8',
};

// path -> Buffer, populated lazily and kept for the server's lifetime (every
// route here is read-only static content that doesn't change mid-run).
const fileCache = new Map();
// path -> in-flight read promise, so N concurrent requests for the same
// not-yet-cached file (e.g. 11 workers all fetching dist/ultra-media.es.js
// at once) share one fs.readFile instead of each starting their own.
const pendingReads = new Map();

async function readCached(filePath) {
  const cached = fileCache.get(filePath);
  if (cached) return cached;

  const pending = pendingReads.get(filePath);
  if (pending) return pending;

  const readPromise = fs
    .readFile(filePath)
    .then((buffer) => {
      fileCache.set(filePath, buffer);
      return buffer;
    })
    .catch(() => null)
    .finally(() => pendingReads.delete(filePath));

  pendingReads.set(filePath, readPromise);
  return readPromise;
}

async function resolveFile(url) {
  const clean = url.split('?')[0];
  for (const route of ROUTES) {
    if (clean.startsWith(route.prefix) || route.prefix === '/') {
      const rel = route.prefix === '/' ? clean : clean.slice(route.prefix.length - 1);
      const filePath = path.join(route.root, decodeURIComponent(rel));
      if (!filePath.startsWith(route.root)) continue; // no path traversal
      const buffer = await readCached(filePath);
      if (buffer) return { filePath, buffer };
    }
  }
  return null;
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    // ADR-0001 D5 - dynamic live HLS/DASH fixture (playlists/MPDs regenerate
    // per request, unlike everything else this server serves, which is
    // read-once-and-cached static content - see live-fixture.mjs).
    if (url.startsWith('/live/') && handleLiveRoute(req, res, FIXTURES_ROOT)) return;

    resolveFile(url).then((found) => {
      if (!found) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const { filePath, buffer } = found;
      const ext = path.extname(filePath);
      const contentType = MIME[ext] ?? 'application/octet-stream';
      const baseHeaders = {
        'content-type': contentType,
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };

      // <video> seeking needs real byte-range support - without a 206
      // response Chrome fails the seek silently and currentTime snaps back
      // to 0.
      const size = buffer.length;
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
        res.end(buffer.subarray(start, end + 1));
        return;
      }

      res.writeHead(200, { ...baseHeaders, 'content-length': size });
      res.end(buffer);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4173);
  createServer().listen(port, () => {
    console.log(`e2e static server listening on http://localhost:${port}`);
  });
}
