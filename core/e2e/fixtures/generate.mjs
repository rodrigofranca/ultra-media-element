#!/usr/bin/env node
/**
 * Regenerates every e2e fixture from scratch, deterministically.
 *
 * Codec decision (see result.md "decisão de codecs/browsers" for the full
 * evidence): H.264 (baseline) + AAC. Playwright's `chromium` channel is
 * "Chrome for Testing", which ships Google's proprietary codec build (unlike
 * open-source Chromium) - `MediaSource.isTypeSupported` and an actual
 * `<video>` playback probe both confirmed real decoding, not just codec
 * string parsing. Firefox's bundled build lacks H.264/AAC (confirmed via the
 * same probe), so it is excluded from the CI-blocking matrix. All content is
 * synthetic (ffmpeg lavfi testsrc2/sine), so generation needs no source
 * media and is fully reproducible.
 *
 * Requires: ffmpeg-static (devDependency, no system ffmpeg needed).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import ffmpegPath from 'ffmpeg-static';

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

const DURATION = 4; // seconds
const FPS = 12;
const HIGH = { w: 480, h: 270, crf: 30 }; // 16:9
const LOW = { w: 320, h: 180, crf: 34 }; // 16:9 (must share aspect ratio with HIGH for one DASH AdaptationSet)
const AUDIO_RATE = 22050;
const AUDIO_BITRATE = '32k';
const GOP = FPS; // 1s keyframe interval, matches 1s HLS/DASH segments

function run(args, cwd) {
  execFileSync(ffmpegPath, ['-hide_banner', '-y', '-loglevel', 'error', ...args], { cwd, stdio: 'inherit' });
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function freshDir(dir) {
  rmrf(dir);
  fs.mkdirSync(dir, { recursive: true });
}

function testsrc(size, freq = 440) {
  return [
    '-f', 'lavfi', '-i', `testsrc2=size=${size.w}x${size.h}:rate=${FPS}:duration=${DURATION}`,
  ];
}

function sine(freq = 440) {
  return ['-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=${AUDIO_RATE}:duration=${DURATION}`];
}

// --- mp4/sample.mp4: single progressive H.264 + AAC file --------------------
function generateMp4() {
  const dir = path.join(FIXTURES_DIR, 'mp4');
  freshDir(dir);
  run([
    ...testsrc(HIGH),
    ...sine(440),
    '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-preset', 'veryslow',
    '-crf', String(HIGH.crf), '-g', String(GOP), '-keyint_min', String(GOP), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ac', '1', '-ar', String(AUDIO_RATE),
    '-movflags', '+faststart',
    'sample.mp4',
  ], dir);
}

// --- mp3/sample.mp3: standalone audio track ---------------------------------
function generateMp3() {
  const dir = path.join(FIXTURES_DIR, 'mp3');
  freshDir(dir);
  run([
    ...sine(523.25), // C5, distinct from the video fixtures' 440Hz tone
    '-c:a', 'libmp3lame', '-b:a', AUDIO_BITRATE, '-ac', '1', '-ar', String(AUDIO_RATE),
    'sample.mp3',
  ], dir);
}

// --- hls/: 2 video renditions (fMP4/CMAF) + 1 alternate audio group ---------
function generateHls() {
  const dir = path.join(FIXTURES_DIR, 'hls');
  freshDir(dir);
  run([
    ...testsrc(HIGH),
    ...testsrc(LOW),
    ...sine(440),
    '-map', '0:v', '-map', '1:v', '-map', '2:a',
    '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-preset', 'veryslow',
    '-crf:v:0', String(HIGH.crf), '-crf:v:1', String(LOW.crf),
    '-g', String(GOP), '-keyint_min', String(GOP), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ac', '1', '-ar', String(AUDIO_RATE),
    '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_flags', 'independent_segments',
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', 'v:0,agroup:aud,name:high v:1,agroup:aud,name:low a:0,agroup:aud,name:English,language:eng,default:yes',
    '-hls_fmp4_init_filename', 'init_%v.mp4',
    'out_%v.m3u8',
  ], dir);
}

// --- dash/: same encode settings, 1 video AdaptationSet w/ 2 Representations
function generateDash() {
  const dir = path.join(FIXTURES_DIR, 'dash');
  freshDir(dir);
  run([
    ...testsrc(HIGH),
    ...testsrc(LOW),
    ...sine(440),
    '-map', '0:v', '-map', '1:v', '-map', '2:a',
    '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-preset', 'veryslow',
    '-crf:v:0', String(HIGH.crf), '-crf:v:1', String(LOW.crf),
    '-g', String(GOP), '-keyint_min', String(GOP), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ac', '1', '-ar', String(AUDIO_RATE),
    '-f', 'dash', '-seg_duration', '1', '-use_template', '1', '-use_timeline', '1',
    '-adaptation_sets', 'id=0,streams=v id=1,streams=a',
    '-init_seg_name', 'init-$RepresentationID$.m4s',
    '-media_seg_name', 'chunk-$RepresentationID$-$Number%05d$.m4s',
    'manifest.mpd',
  ], dir);
}

// --- manifest.json: expected values the specs assert against ---------------
function writeManifest() {
  const manifest = {
    duration: DURATION,
    mp4: { width: HIGH.w, height: HIGH.h },
    mp3: {},
    hls: {
      renditions: [
        { width: HIGH.w, height: HIGH.h },
        { width: LOW.w, height: LOW.h },
      ],
      audioTracks: 1,
    },
    dash: {
      // dash.js exposes one MediaInfo per AdaptationSet via getTracksFor('video'),
      // not one per Representation - see result.md "Descobertas".
      // The manifest still carries 2 real video Representations (verified via
      // manifest.mpd + BUFFERED_RANGE/quality events in the dash spec).
      videoAdaptationSets: 1,
      videoRepresentationsInAdaptationSet: 2,
      audioTracks: 1,
    },
  };
  fs.writeFileSync(
    path.join(FIXTURES_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
}

generateMp4();
generateMp3();
generateHls();
generateDash();
writeManifest();

console.log('Fixtures regenerated in', FIXTURES_DIR);
