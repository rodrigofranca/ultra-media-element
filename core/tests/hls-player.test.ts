import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { HlsPlayer } from '../src/players/hls-player';

function createVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

type ErrorHandler = (event: unknown, data: any) => void;

async function setupPlayerWithErrorHandler(): Promise<{ player: HlsPlayer; trigger: ErrorHandler }> {
  let trigger: ErrorHandler = () => {};

  (window as any).Hls = jest.fn().mockImplementation(() => ({
    attachMedia: jest.fn(),
    on: jest.fn((event: string, cb: ErrorHandler) => {
      if (event === 'hlsError') trigger = cb;
    }),
    loadSource: jest.fn(),
  }));
  (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);

  const player = new HlsPlayer(createVideoElement());
  await player.onReady;

  return { player, trigger };
}

describe('HlsPlayer error mapping', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it('maps a fatal manifest networkError to fatal:true / category:networkError', async () => {
    const { player, trigger } = await setupPlayerWithErrorHandler();
    const onError = jest.fn();
    player.onError(onError);

    const cause = new Error('boom');
    trigger(null, {
      type: 'networkError',
      details: 'manifestLoadError',
      fatal: true,
      response: { code: 404 },
      url: 'https://example.com/master.m3u8',
      error: cause,
    });

    expect(onError).toHaveBeenCalledWith({
      fatal: true,
      category: 'networkError',
      code: 'manifestLoadError',
      message: 'boom',
      engine: 'hls.js',
      url: 'https://example.com/master.m3u8',
      status: 404,
      cause,
    });
  });

  it('maps a non-fatal fragment load error to fatal:false, unchanged category', async () => {
    const { player, trigger } = await setupPlayerWithErrorHandler();
    const onError = jest.fn();
    player.onError(onError);

    trigger(null, {
      type: 'networkError',
      details: 'fragLoadError',
      fatal: false,
      url: 'https://example.com/seg1.m4s',
      error: new Error('HTTP Error 500'),
    });

    expect(onError.mock.calls[0][0]).toMatchObject({
      fatal: false,
      category: 'networkError',
      code: 'fragLoadError',
      engine: 'hls.js',
    });
  });

  it('collapses muxError/keySystemError into the closest category', async () => {
    const { player, trigger } = await setupPlayerWithErrorHandler();
    const onError = jest.fn();
    player.onError(onError);

    trigger(null, { type: 'muxError', details: 'remuxAllocError', fatal: true });
    expect(onError.mock.calls[0][0].category).toBe('mediaError');

    trigger(null, { type: 'keySystemError', details: 'keySystemNoKeys', fatal: true });
    expect(onError.mock.calls[1][0].category).toBe('otherError');
  });
});

// Simulates a slow CDN load for the SDK script via the `System.import` path
// network.ts already supports (see utils/network.ts) - much easier to
// control precisely than a real <script> tag, which jsdom never executes.
function deferredHlsImport() {
  let resolveImport: (mod: { default: any }) => void = () => {};
  (window as any).System = {
    import: jest.fn().mockReturnValue(new Promise((resolve) => { resolveImport = resolve as any; })),
  };

  const loadSource = jest.fn();
  const HlsCtor: any = jest.fn().mockImplementation(() => ({
    attachMedia: jest.fn(),
    on: jest.fn(),
    loadSource,
    destroy: jest.fn(),
  }));
  HlsCtor.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  HlsCtor.isSupported = jest.fn().mockReturnValue(true);

  return {
    loadSource,
    HlsCtor,
    // A real hls.js CDN script sets `window.Hls` itself as a side effect of
    // executing, which is what lets loadSDK() short-circuit on a later call
    // for the same URL - set it here too so the mock matches that.
    resolve: () => {
      (window as any).Hls = HlsCtor;
      resolveImport({ default: HlsCtor });
    },
  };
}

// network.ts's loadSDK() caches its pending-request promises in a
// module-level map keyed by URL and never clears it after a successful
// load (only on error) - fine in production (the real CDN script sets
// `window.Hls`, so a later loadSDK() call for the same URL short-circuits
// on that instead of ever touching the stale cache), but it means two
// `it()`s in the same file both waiting on `HLS_JS_SDK_URL` would collide.
// jest.isolateModulesAsync gives each test its own fresh network.ts (and
// therefore HlsPlayer) module instance, sidestepping that entirely.
async function withDeferredHlsPlayer(
  run: (ctx: { HlsPlayer: typeof HlsPlayer } & ReturnType<typeof deferredHlsImport>) => Promise<void>
): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    const freshModule = require('../src/players/hls-player');
    await run({ HlsPlayer: freshModule.HlsPlayer, ...deferredHlsImport() });
  });
}

describe('HlsPlayer cancellation (destroy()/rapid src swap during SDK load)', () => {
  afterEach(() => {
    delete (window as any).System;
    delete (window as any).Hls;
  });

  // player-factory.ts:64 used to keep `onReady.then(() => player.load(src))`
  // alive even after destroy() ran, so once the CDN script finally loaded,
  // hls.js still got instantiated and started fetching the (by then
  // cancelled) source - an orphan instance/downloads after teardown.
  it('never creates the hls.js instance if destroy() runs before the SDK finishes loading', async () => {
    await withDeferredHlsPlayer(async ({ HlsPlayer: FreshHlsPlayer, HlsCtor, resolve }) => {
      const player = new FreshHlsPlayer(createVideoElement());
      player.load('https://example.com/a.m3u8');
      player.destroy();

      resolve();
      await player.onReady;

      expect(HlsCtor).not.toHaveBeenCalled();
    });
  });

  // A -> B -> C in quick succession, all before the SDK is ready: only C
  // should ever be requested once hls.js is finally instantiated.
  it('applies only the last load() requested before the SDK finished loading', async () => {
    await withDeferredHlsPlayer(async ({ HlsPlayer: FreshHlsPlayer, loadSource, resolve }) => {
      const player = new FreshHlsPlayer(createVideoElement());
      player.load('https://example.com/a.m3u8');
      player.load('https://example.com/b.m3u8');
      player.load('https://example.com/c.m3u8');

      resolve();
      await player.onReady;

      expect(loadSource).toHaveBeenCalledTimes(1);
      expect(loadSource).toHaveBeenCalledWith('https://example.com/c.m3u8');
    });
  });
});
