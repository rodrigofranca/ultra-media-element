import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { HlsPlayer } from '../src/players/hls-player';
import { VideoPlayer } from '../src/players/video-player';

function createVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

type ErrorHandler = (event: unknown, data: any) => void;

async function setupPlayerWithErrorHandler(): Promise<{ player: HlsPlayer; trigger: ErrorHandler; nativeEl: HTMLVideoElement }> {
  let trigger: ErrorHandler = () => {};

  (window as any).Hls = jest.fn().mockImplementation(() => ({
    attachMedia: jest.fn(),
    on: jest.fn((event: string, cb: ErrorHandler) => {
      if (event === 'hlsError') trigger = cb;
    }),
    loadSource: jest.fn(),
    destroy: jest.fn(),
  }));
  (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);

  const nativeEl = createVideoElement();
  const player = new HlsPlayer(nativeEl);
  await player.onReady;

  return { player, trigger, nativeEl };
}

function fakeMediaError(code: number, message = ''): MediaError {
  return { code, message, MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 } as MediaError;
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

describe('HlsPlayer native <video> error forwarding', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  // hls.js's own BufferController._onMediaError only logs the native
  // `error` event (node_modules/hls.js/dist/hls.js ~21481-21488) - it never
  // re-triggers Hls.Events.ERROR for it, so a genuine MSE/decode failure on
  // the <video> element was reaching neither `error` nor `warning`.
  it('translates a native <video> error into a fatal error through the same callback', async () => {
    const { player, nativeEl } = await setupPlayerWithErrorHandler();
    const onError = jest.fn();
    player.onError(onError);

    Object.defineProperty(nativeEl, 'error', { value: fakeMediaError(3, 'decode failed'), configurable: true });
    nativeEl.dispatchEvent(new Event('error'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      fatal: true,
      category: 'mediaError',
      code: 'MEDIA_ERR_DECODE',
      engine: 'hls.js',
    });
  });

  it('stops listening for the native error once destroyed (no spurious event on teardown)', async () => {
    const { player, nativeEl } = await setupPlayerWithErrorHandler();
    const onError = jest.fn();
    player.onError(onError);

    player.destroy();

    Object.defineProperty(nativeEl, 'error', { value: fakeMediaError(2), configurable: true });
    nativeEl.dispatchEvent(new Event('error'));

    expect(onError).not.toHaveBeenCalled();
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

// Chromium never takes this branch (no native HLS support), so this is
// unit-only: simulates Safari/older Smart TVs, where hls.js reports
// `Hls.isSupported() === false` (no MSE) but the <video> can still play HLS
// natively (`canPlayType('application/vnd.apple.mpegurl')` truthy) -
// applyLoad()'s `else if` branch, which sets `nativeEl.src` directly and
// bypasses hls.js entirely. destroy() only ever called `hls.destroy()`,
// which has no idea that src was set outside its own API - the native
// <video> kept the source and kept downloading (cycle 3, defect 2).
async function setupNativeFallbackPlayer(): Promise<{ player: HlsPlayer; nativeEl: HTMLVideoElement }> {
  (window as any).Hls = jest.fn().mockImplementation(() => ({
    attachMedia: jest.fn(),
    on: jest.fn(),
    loadSource: jest.fn(),
    destroy: jest.fn(),
  }));
  (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  (window as any).Hls.isSupported = jest.fn().mockReturnValue(false);

  const nativeEl = createVideoElement();
  nativeEl.canPlayType = jest.fn().mockReturnValue('maybe');
  const player = new HlsPlayer(nativeEl);
  await player.onReady;
  player.load('https://example.com/master.m3u8');

  return { player, nativeEl };
}

describe('HlsPlayer native HLS fallback (no MSE) teardown (cycle 3, defect 2)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it('load() on the native fallback path sets the native src directly (no hls.js loadSource)', async () => {
    const { nativeEl } = await setupNativeFallbackPlayer();
    expect(nativeEl.getAttribute('src')).toBe('https://example.com/master.m3u8');
  });

  it('destroy() removes the native src, stopping the <video> from downloading it', async () => {
    const { player, nativeEl } = await setupNativeFallbackPlayer();
    expect(nativeEl.hasAttribute('src')).toBe(true);

    player.destroy();

    expect(nativeEl.hasAttribute('src')).toBe(false);
  });

  it('destroy() on the native fallback path emits no spurious error', async () => {
    const { player } = await setupNativeFallbackPlayer();
    const onError = jest.fn();
    player.onError(onError);

    player.destroy();

    expect(onError).not.toHaveBeenCalled();
  });

  it('switching from the HLS-native fallback to another engine leaves no stale src behind', async () => {
    const { player, nativeEl } = await setupNativeFallbackPlayer();

    player.destroy();
    const videoPlayer = new VideoPlayer(nativeEl);
    videoPlayer.load('https://example.com/video.mp4');

    expect(nativeEl.getAttribute('src')).toBe('https://example.com/video.mp4');
  });

  it('destroy() before the SDK finishes loading never sets a native src, even when it resolves unsupported', async () => {
    await withDeferredHlsPlayer(async ({ HlsPlayer: FreshHlsPlayer, HlsCtor, resolve }) => {
      HlsCtor.isSupported = jest.fn().mockReturnValue(false);
      const nativeEl = createVideoElement();
      nativeEl.canPlayType = jest.fn().mockReturnValue('maybe');
      const player = new FreshHlsPlayer(nativeEl);
      player.load('https://example.com/a.m3u8');
      player.destroy();

      resolve();
      await player.onReady;

      expect(nativeEl.hasAttribute('src')).toBe(false);
      expect(HlsCtor).not.toHaveBeenCalled();
    });
  });
});
