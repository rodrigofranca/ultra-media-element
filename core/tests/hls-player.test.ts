import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { HlsPlayer } from '../src/players/hls-player';
import { VideoPlayer } from '../src/players/video-player';
import type { RequestPolicy } from '../src/core/request-policy';

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

  // A new load resets `element.error` to null, so an `error` event still
  // queued for the superseded source arrives with no MediaError - it must
  // not be reported as the current load's failure.
  it('ignores a stale native error event that carries no MediaError', async () => {
    const { player, nativeEl } = await setupPlayerWithErrorHandler();
    const onError = jest.fn();
    player.onError(onError);

    Object.defineProperty(nativeEl, 'error', { value: null, configurable: true });
    nativeEl.dispatchEvent(new Event('error'));

    expect(onError).not.toHaveBeenCalled();
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

// ADR-0001 D4 - captures the `config` object HlsPlayer builds and passes to
// `new Hls(config)`, so xhrSetup/fetchSetup can be invoked directly here the
// same way hls.js's own XhrLoader/FetchLoader would.
async function setupPlayerWithConfig(requestPolicy?: RequestPolicy): Promise<{ player: HlsPlayer; config: any; nativeEl: HTMLVideoElement }> {
  let config: any;
  (window as any).Hls = jest.fn().mockImplementation((cfg: any) => {
    config = cfg;
    return { attachMedia: jest.fn(), on: jest.fn(), loadSource: jest.fn(), destroy: jest.fn() };
  });
  (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);

  const nativeEl = createVideoElement();
  const player = new HlsPlayer(nativeEl, requestPolicy);
  await player.onReady;

  return { player, config, nativeEl };
}

function fakeXhr(): XMLHttpRequest {
  return { setRequestHeader: jest.fn(), open: jest.fn(), withCredentials: false } as unknown as XMLHttpRequest;
}

describe('HlsPlayer request policy (ADR-0001 D4)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it('xhrSetup applies static headers to context.headers, classified by hls.js loader context type', async () => {
    const { config } = await setupPlayerWithConfig({ headers: { Authorization: 'Bearer t' } });
    const xhr = fakeXhr();
    const context: any = { url: 'https://example.com/master.m3u8', type: 'manifest' };

    config.xhrSetup(xhr, context.url, context);

    expect(context.headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('xhrSetup calls a headers function once per request, passing the classified context', async () => {
    const headers = jest.fn().mockReturnValue({ Authorization: 'Bearer t' });
    const { config } = await setupPlayerWithConfig({ headers });
    const xhr = fakeXhr();

    config.xhrSetup(xhr, '', { url: 'https://example.com/seg1.m4s', type: 'media-fragment' });
    config.xhrSetup(xhr, '', { url: 'https://example.com/seg2.m4s', type: 'media-fragment' });

    expect(headers).toHaveBeenCalledTimes(2);
    expect(headers).toHaveBeenCalledWith({ url: 'https://example.com/seg1.m4s', type: 'segment', engine: 'hls.js' });
  });

  it('classifies key/manifest/segment loader context types', async () => {
    const headers = jest.fn().mockReturnValue({});
    const { config } = await setupPlayerWithConfig({ headers });
    const xhr = fakeXhr();

    config.xhrSetup(xhr, '', { url: 'k', type: 'key' });
    config.xhrSetup(xhr, '', { url: 'l', type: 'level' });
    config.xhrSetup(xhr, '', { url: 'o', type: 'server-certificate' });

    expect(headers.mock.calls.map((c: any) => c[0].type)).toEqual(['key', 'manifest', 'other']);
  });

  // result-cycle2.md defect 5 - XHR's `withCredentials` is a boolean, so
  // 'omit' and 'same-origin' are indistinguishable through it (a same-origin
  // XHR always sends cookies regardless of the flag - see README.md).
  // `xhr.withCredentials` is assigned unconditionally in xhrSetup (not just
  // `if` 'include'), so every value maps to exactly what the browser can
  // actually tell apart: only 'include' -> true, everything else -> false.
  it.each([
    ['include', true],
    ['omit', false],
    ['same-origin', false],
  ] as const)('credentials:"%s" sets xhr.withCredentials to %s', async (credentials, expected) => {
    const { config } = await setupPlayerWithConfig({ credentials });
    const xhr = fakeXhr();

    config.xhrSetup(xhr, '', { url: 'https://example.com/a', type: 'manifest' });

    expect(xhr.withCredentials).toBe(expected);
  });

  it('transformUrl runs before headers(ctx), which sees the transformed URL', async () => {
    const headers = jest.fn().mockReturnValue({});
    const { config } = await setupPlayerWithConfig({
      transformUrl: (ctx) => ctx.url + '?sig=1',
      headers,
    });
    const xhr = fakeXhr();
    const context: any = { url: 'https://example.com/master.m3u8', type: 'manifest' };

    config.xhrSetup(xhr, context.url, context);

    // context.url itself is never rewritten any more (see the retry-safety
    // test below, defect 1) - the transformed URL is what the XHR actually
    // opens at.
    expect(xhr.open).toHaveBeenCalledWith('GET', 'https://example.com/master.m3u8?sig=1', true);
    expect(headers).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/master.m3u8?sig=1' }));
  });

  // result-cycle2.md defect 1 (Bloqueante) - hls.js's own BaseLoader.retry()
  // (node_modules/hls.js/dist/hls.js ~38859-38873) reuses this exact
  // `context` object on every retry attempt, calling xhrSetup again with it
  // unchanged. Before the fix, xhrSetup wrote the transformed URL back onto
  // `context.url`, so the second call transformed an already-transformed
  // URL (`?sig=1` -> `?sig=1&sig=1`).
  it('retrying with the same context (hls.js BaseLoader.retry reuses it) does not double-apply transformUrl', async () => {
    const { config } = await setupPlayerWithConfig({
      transformUrl: (ctx) => ctx.url + (ctx.url.includes('?') ? '&' : '?') + 'sig=1',
    });
    const context: any = { url: 'https://example.com/seg1.m4s', type: 'media-fragment' };
    const firstAttemptXhr = fakeXhr();
    const retryXhr = fakeXhr();

    config.xhrSetup(firstAttemptXhr, context.url, context); // first attempt
    config.xhrSetup(retryXhr, context.url, context); // hls.js's own retry - same context object

    expect(firstAttemptXhr.open).toHaveBeenCalledWith('GET', 'https://example.com/seg1.m4s?sig=1', true);
    expect(retryXhr.open).toHaveBeenCalledWith('GET', 'https://example.com/seg1.m4s?sig=1', true);
  });

  it('a throwing headers()/transformUrl() reports REQUEST_POLICY_ERROR through onError instead of throwing', async () => {
    const { config, player } = await setupPlayerWithConfig({
      transformUrl: () => { throw new Error('boom'); },
    });
    const onError = jest.fn();
    player.onError(onError);
    const xhr = fakeXhr();

    expect(() => config.xhrSetup(xhr, '', { url: 'https://example.com/a', type: 'manifest' })).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, code: 'REQUEST_POLICY_ERROR', engine: 'hls.js' }));
  });

  // result-cycle2.md defect 4 - a `headers()` that throws *after* a
  // successful `transformUrl()` used to leave the request in a mixed state
  // (transformed URL, no headers, but still credentialed). On any policy
  // callback failure the request now goes out exactly as it would with no
  // policy at all: original URL, no headers, no credentials.
  it('a headers() that throws after a successful transformUrl() rolls back the URL too and skips credentials, not just headers', async () => {
    const { config, player } = await setupPlayerWithConfig({
      transformUrl: (ctx) => ctx.url + '?sig=1',
      headers: () => { throw new Error('token expired'); },
      credentials: 'include',
    });
    const onError = jest.fn();
    player.onError(onError);
    const xhr = fakeXhr();
    const context: any = { url: 'https://example.com/master.m3u8', type: 'manifest' };

    config.xhrSetup(xhr, context.url, context);

    expect(xhr.open).toHaveBeenCalledWith('GET', 'https://example.com/master.m3u8', true);
    expect(context.headers).toBeUndefined();
    expect(xhr.withCredentials).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, code: 'REQUEST_POLICY_ERROR', engine: 'hls.js' }));
  });

  it('fetchSetup applies headers/credentials and returns a Request for the (possibly transformed) URL', async () => {
    // jsdom (this project's jest testEnvironment) implements `Headers` but
    // not the `Request` constructor - stubbed just enough to assert on
    // (real hls.js only ever calls this in a real browser).
    (global as any).Request = class {
      url: string;
      constructor(url: string, public init: any) { this.url = url; }
    };
    const { config } = await setupPlayerWithConfig({
      headers: { Authorization: 'Bearer t' },
      credentials: 'include',
      transformUrl: (ctx) => ctx.url + '?sig=1',
    });
    const initParams = { headers: new Headers() };

    const request = config.fetchSetup({ url: 'https://example.com/master.m3u8', type: 'manifest' }, initParams);

    expect(request.url).toBe('https://example.com/master.m3u8?sig=1');
    expect(initParams.headers.get('Authorization')).toBe('Bearer t');
    expect(initParams.credentials).toBe('include');
    delete (global as any).Request;
  });

  // result-cycle2.md defect 6 (Registrar, não implementar) - DRM is P2, out
  // of scope for this cycle. hls.js applies license requests through a
  // *separate* `config.licenseXhrSetup` hook (node_modules/hls.js/dist/hls.js
  // ~39462, consumed at ~27442-27470), never through the `xhrSetup`/
  // `fetchSetup` this file sets - so options.request does not reach license
  // requests today. TODO(drm): wire licenseXhrSetup once DRM is in scope
  // (docs/adr/0001-headless-core-and-element-shell.md D7).
  it('never sets config.licenseXhrSetup - options.request does not reach DRM license requests (documents current behavior)', async () => {
    const { config } = await setupPlayerWithConfig({ headers: { Authorization: 'Bearer t' } });
    expect(config.licenseXhrSetup).toBeUndefined();
  });

  it('configure()-style: a later load() with a different request policy changes what the next request carries, without recreating the hls.js instance', async () => {
    const { config, player } = await setupPlayerWithConfig({ headers: { Authorization: 'Bearer old' } });
    const xhr = fakeXhr();

    player.load('https://example.com/master.m3u8', { headers: { Authorization: 'Bearer new' } });

    const context: any = { url: 'https://example.com/master.m3u8', type: 'manifest' };
    config.xhrSetup(xhr, context.url, context);

    expect(context.headers).toEqual({ Authorization: 'Bearer new' });
  });
});

describe('HlsPlayer native HLS fallback request policy (no MSE - ADR-0001 D4)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it('applies transformUrl/crossOrigin to the native src and reports REQUEST_HEADERS_UNSUPPORTED once when headers are configured', async () => {
    (window as any).Hls = jest.fn().mockImplementation(() => ({ attachMedia: jest.fn(), on: jest.fn(), loadSource: jest.fn(), destroy: jest.fn() }));
    (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(false);

    const nativeEl = createVideoElement();
    nativeEl.canPlayType = jest.fn().mockReturnValue('maybe');
    const requestPolicy: RequestPolicy = {
      transformUrl: (ctx) => ctx.url + '?sig=1',
      credentials: 'include',
      headers: { Authorization: 'Bearer t' },
    };
    const player = new HlsPlayer(nativeEl, requestPolicy);
    await player.onReady;
    const onError = jest.fn();
    player.onError(onError);

    player.load('https://example.com/master.m3u8', requestPolicy);

    expect(nativeEl.getAttribute('src')).toBe('https://example.com/master.m3u8?sig=1');
    expect(nativeEl.crossOrigin).toBe('use-credentials');
    expect(onError).not.toHaveBeenCalled(); // deferred to a microtask

    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, code: 'REQUEST_HEADERS_UNSUPPORTED', engine: 'hls.js' }));
  });

  // result-cycle2.md defect 2 - same crossOrigin-restore contract as
  // VideoPlayer/AudioPlayer (native-players-error.test.ts), for the one
  // other place applyNativeLoad's crossOrigin write happens: hls.js's own
  // no-MSE native fallback.
  it('destroy() restores crossOrigin to what it was before the native fallback load (including absent)', async () => {
    (window as any).Hls = jest.fn().mockImplementation(() => ({ attachMedia: jest.fn(), on: jest.fn(), loadSource: jest.fn(), destroy: jest.fn() }));
    (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(false);

    const nativeEl = createVideoElement();
    nativeEl.canPlayType = jest.fn().mockReturnValue('maybe');
    const player = new HlsPlayer(nativeEl, { credentials: 'include' });
    await player.onReady;
    expect(nativeEl.hasAttribute('crossorigin')).toBe(false);

    player.load('https://example.com/master.m3u8', { credentials: 'include' });
    expect(nativeEl.crossOrigin).toBe('use-credentials');

    player.destroy();

    expect(nativeEl.hasAttribute('crossorigin')).toBe(false);
  });

  // result-cycle2.md defect 3(b)/(c) - same generation-gating contract as
  // VideoPlayer/AudioPlayer for a policy warning scheduled by this branch.
  it('a load() immediately superseded by another one before its deferred headers-unsupported warning fires reports nothing for the stale load', async () => {
    (window as any).Hls = jest.fn().mockImplementation(() => ({ attachMedia: jest.fn(), on: jest.fn(), loadSource: jest.fn(), destroy: jest.fn() }));
    (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(false);

    const nativeEl = createVideoElement();
    nativeEl.canPlayType = jest.fn().mockReturnValue('maybe');
    const player = new HlsPlayer(nativeEl);
    await player.onReady;
    const onError = jest.fn();
    player.onError(onError);

    player.load('https://example.com/a.m3u8', { headers: { Authorization: 'Bearer t' } });
    player.load('https://example.com/b.m3u8'); // supersedes A before its deferred warning fires

    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });
});
