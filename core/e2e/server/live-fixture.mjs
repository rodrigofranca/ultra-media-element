/**
 * ADR-0001 D5 - synthetic, hermetic, deterministic live HLS/DASH fixture,
 * layered on top of static-server.mjs. No wall-clock/timers: "now" for a
 * given stream is driven purely by how many times its playlist/MPD has been
 * requested (`state.reloads`), which is exactly the cadence hls.js/dash.js
 * themselves poll a live manifest at (~once per target duration) - so a
 * spec doesn't need to sleep/poll the *server* to advance the window, only
 * the player.
 *
 * Content: reuses the existing VOD fixture's 4 video-only fMP4 segments
 * (`e2e/fixtures/hls/out_high{0..3}.m4s` / `e2e/fixtures/dash/chunk-0-000
 * {1..4}.m4s`, 1s each - see fixtures/generate.mjs) looped forever via a
 * `physical = n % 4` remap in the segment routes - no new fixtures
 * generated. Looping the same bytes back means a segment's own internal MP4
 * timestamps repeat/jump backwards every 4 segments; documented, not fixed
 * (see result.md "fixture live") - `#EXT-X-DISCONTINUITY` is emitted at
 * every loop boundary so hls.js treats it as a declared discontinuity
 * instead of a timestamp anomaly. DASH has no equivalent tag; dash.js has
 * been observed tolerant of it in this harness (SegmentTimeline is
 * authoritative over segment-internal timestamps for its default append
 * mode) - also documented, not proven for every dash.js version.
 *
 * One playlist per (engine, streamId): streamId is chosen by the test
 * (typically per-test-unique), so parallel Playwright workers never share
 * state. `?window=N` (segment count) sets the DVR window on first request;
 * `GET /live/control/:id/end` freezes it and marks it ended.
 */
import path from 'node:path';
import fs from 'node:fs/promises';

const SEGMENT_DURATION = 1; // seconds - matches fixtures/generate.mjs (1s GOP/segments)
const PHYSICAL_SEGMENTS = 4; // out_high0..3.m4s / chunk-0-00001..00004.m4s
const TIMESCALE = 12288; // matches e2e/fixtures/dash/manifest.mpd's Representation id="0"
// Fixed, synthetic wallclock origin - not Date.now(): segment N's
// PROGRAM-DATE-TIME/availabilityStartTime-derived UTC time is always
// EPOCH_BASE + N seconds, so e2e specs can assert playheadDate against a
// plain formula instead of a real-time race.
const EPOCH_BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

const streams = new Map(); // `${engine}:${id}` -> { reloads, ended, window, dashAvailabilityStartMs, dashEndedAtMs }

function stateFor(engine, id, window) {
  const key = `${engine}:${id}`;
  let state = streams.get(key);
  if (!state) {
    const win = Math.max(1, window || 3);
    state = {
      reloads: 0,
      ended: false,
      window: win,
      // DASH only (buildDashMpd): real-wallclock anchor, `window` seconds in
      // the past so a full window is already available on the very first
      // request - see buildDashMpd's header comment for why DASH doesn't
      // reuse the HLS reload-counter model.
      dashAvailabilityStartMs: Date.now() - win * SEGMENT_DURATION * 1000,
      dashEndedAtMs: null,
    };
    streams.set(key, state);
  }
  return state;
}

/** Ascending segment numbers currently in the HLS sliding window; advances state.reloads unless ended. */
function windowSegments(state) {
  if (!state.ended) state.reloads += 1;
  const total = state.reloads + state.window - 1;
  const first = Math.max(0, total - state.window);
  const nums = [];
  for (let n = first; n < total; n++) nums.push(n);
  return nums;
}

function segmentDate(n) {
  return new Date(EPOCH_BASE_MS + n * SEGMENT_DURATION * 1000);
}

function hlsSegmentUrl(id, n) {
  return `/live/hls/${id}/seg-${n}.m4s`;
}

function buildHlsPlaylist(id, state) {
  const nums = windowSegments(state);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${SEGMENT_DURATION}`,
    `#EXT-X-MEDIA-SEQUENCE:${nums[0]}`,
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MAP:URI="init.mp4"',
  ];
  let previous = null;
  for (const n of nums) {
    // A loop boundary (this segment's physical file index is <= the
    // previous one's) is a real timestamp discontinuity - see this file's
    // header comment.
    if (previous !== null && n % PHYSICAL_SEGMENTS <= previous % PHYSICAL_SEGMENTS) {
      lines.push('#EXT-X-DISCONTINUITY');
    }
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${segmentDate(n).toISOString()}`);
    lines.push(`#EXTINF:${SEGMENT_DURATION.toFixed(6)},`);
    lines.push(hlsSegmentUrl(id, n));
    previous = n;
  }
  if (state.ended) lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

// DASH doesn't reuse HLS's reload-counter sliding window - a different
// design choice, not a workaround: dash.js *does* reload a dynamic MPD
// autonomously on its own `minimumUpdatePeriod` timer (proven in
// e2e/tests/live.spec.ts's "reloads live.mpd autonomously" and "ending the
// broadcast... via a real autonomous reload" specs) - ciclo 1's conclusion
// that it didn't was wrong (result-cycle2.md, defect 9): the real cause was
// calling `video.play()` before dash.js's PlaybackController had attached
// its own native `play` listener (only done once the manifest is parsed),
// silently missing the one-time PLAYBACK_STARTED signal ManifestUpdater's
// first `startManifestRefreshTimer()` call is gated on - see
// e2e/tests/live.spec.ts's header comment for the full mechanism. A plain
// `duration`-based SegmentTemplate (no SegmentTimeline) is used here for an
// unrelated, still-valid reason: dash.js computes which segment numbers
// exist itself, from `availabilityStartTime` + real elapsed time, so
// segment availability never depends on a reload actually having happened
// yet - handy for a synthetic fixture where the reload cadence is the thing
// being tested. `availabilityStartTime` is anchored `window` seconds into
// the past (real wallclock, captured once per stream in stateFor()) so
// numbers/presentation time stay small and a window's worth of content is
// available immediately - see result-cycle2.md "fixture DASH" for the full
// writeup, including that this makes DASH's clock real-time-relative where
// HLS's stays purely request-count-driven.
function buildDashMpd(id, state) {
  const dynamic = !state.ended;
  const nowMs = dynamic ? Date.now() : state.dashEndedAtMs;
  const elapsedSegments = Math.max(1, Math.round((nowMs - state.dashAvailabilityStartMs) / (SEGMENT_DURATION * 1000)));
  const attrs = [
    `type="${dynamic ? 'dynamic' : 'static'}"`,
    `availabilityStartTime="${new Date(state.dashAvailabilityStartMs).toISOString()}"`,
    dynamic ? `minimumUpdatePeriod="PT${SEGMENT_DURATION}.0S"` : null,
    dynamic ? `timeShiftBufferDepth="PT${state.window * SEGMENT_DURATION}.0S"` : null,
    !dynamic ? `mediaPresentationDuration="PT${elapsedSegments * SEGMENT_DURATION}.0S"` : null,
    'minBufferTime="PT2.0S"',
  ].filter(Boolean).join(' ');

  return `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011" ${attrs}>
  <UTCTiming schemeIdUri="urn:mpeg:dash:utc:direct:2014" value="${new Date().toISOString()}" />
  <Period id="0" start="PT0.0S">
    <AdaptationSet id="0" contentType="video" segmentAlignment="true" maxWidth="480" maxHeight="270" par="16:9">
      <Representation id="0" mimeType="video/mp4" codecs="avc1.42c01f" bandwidth="173100" width="480" height="270" sar="1:1">
        <SegmentTemplate timescale="${TIMESCALE}" duration="${TIMESCALE}" initialization="init.m4s" media="seg-$Number$.m4s" startNumber="0" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>\n`;
}

async function readPhysicalSegment(fixturesRoot, engine, n) {
  const physical = n % PHYSICAL_SEGMENTS;
  const file = engine === 'hls'
    ? path.join(fixturesRoot, 'hls', `out_high${physical}.m4s`)
    : path.join(fixturesRoot, 'dash', `chunk-0-${String(physical + 1).padStart(5, '0')}.m4s`);
  return fs.readFile(file);
}

async function readInit(fixturesRoot, engine) {
  const file = engine === 'hls'
    ? path.join(fixturesRoot, 'hls', 'init_high.mp4')
    : path.join(fixturesRoot, 'dash', 'init-0.m4s');
  return fs.readFile(file);
}

const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

/**
 * Handles a `/live/...` request. Returns true if handled (response already
 * sent), false if the URL isn't a live-fixture route (caller falls back to
 * the normal static file resolution).
 */
export function handleLiveRoute(req, res, fixturesRoot) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['live', engine|'control', id, file]
  if (parts[0] !== 'live') return false;

  if (parts[1] === 'control' && parts[3] === 'end') {
    const [, , id] = parts;
    for (const engine of ['hls', 'dash']) {
      const state = streams.get(`${engine}:${id}`);
      if (!state || state.ended) continue;
      state.ended = true;
      state.dashEndedAtMs = Date.now();
    }
    res.writeHead(200, TEXT_HEADERS);
    res.end('ok');
    return true;
  }

  const engine = parts[1];
  const id = parts[2];
  const file = parts[3];
  if ((engine !== 'hls' && engine !== 'dash') || !id || !file) return false;

  if (file === 'live.m3u8' || file === 'live.mpd') {
    const window = Number(url.searchParams.get('window')) || undefined;
    const state = stateFor(engine, id, window);
    const body = engine === 'hls' ? buildHlsPlaylist(id, state) : buildDashMpd(id, state);
    res.writeHead(200, {
      'content-type': engine === 'hls' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(body);
    return true;
  }

  const segmentMatch = /^seg-(\d+)\.m4s$/.exec(file);
  const isInit = file === 'init.mp4' || file === 'init.m4s';
  if (segmentMatch || isInit) {
    const read = segmentMatch ? readPhysicalSegment(fixturesRoot, engine, Number(segmentMatch[1])) : readInit(fixturesRoot, engine);
    read.then((buffer) => {
      res.writeHead(200, {
        'content-type': 'video/iso.segment',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
        'content-length': buffer.length,
      });
      res.end(buffer);
    }).catch(() => {
      res.writeHead(404, TEXT_HEADERS);
      res.end('Not found');
    });
    return true;
  }

  return false;
}

/** Test-only: lets a spec reset a streamId between runs without restarting the server. */
export function resetLiveStream(engine, id) {
  streams.delete(`${engine}:${id}`);
}
