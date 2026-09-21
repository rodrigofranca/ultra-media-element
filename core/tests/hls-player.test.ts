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

// ADR-0001 D5
type LevelLoadedHandler = (event: unknown, data: { details: { live: boolean } }) => void;

async function setupLivePlayer(liveOpt?: boolean | 'auto', src = 'https://example.com/live.m3u8') {
  const handlers: Record<string, (event: unknown, data: any) => void> = {};
  const hlsInstance: any = {
    attachMedia: jest.fn(),
    on: jest.fn((event: string, cb: (event: unknown, data: any) => void) => { handlers[event] = cb; }),
    // result-cycle3.md, defect 3 - bindLevelLoaded() removes the previous
    // generation's listener before attaching a fresh one; the mock mirrors
    // real hls.js's on/off pairing so that re-binding is observable too.
    off: jest.fn((event: string, cb: (event: unknown, data: any) => void) => {
      if (handlers[event] === cb) delete handlers[event];
    }),
    loadSource: jest.fn(),
    destroy: jest.fn(),
    liveSyncPosition: null as number | null,
    playingDate: null as Date | null,
  };
  (window as any).Hls = jest.fn().mockImplementation(() => hlsInstance);
  (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed', LEVEL_LOADED: 'hlsLevelLoaded' };
  (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);

  const nativeEl = createVideoElement();
  const player = new HlsPlayer(nativeEl, undefined, liveOpt);
  // result-cycle3.md, defect 3 - LEVEL_LOADED is now bound inside
  // applyLoad(), itself only reachable through load() (matches real usage:
  // PlayerFactory always calls load() right after construction) - a bare
  // `new HlsPlayer()` with no load() would leave `handlers['hlsLevelLoaded']`
  // unset, unlike the old always-bound-in-setup() behavior. `liveOpt` must be
  // passed through explicitly - load() always overwrites it (result-cycle2.md,
  // defect 4), constructor-time or not.
  player.load(src, undefined, liveOpt);
  await player.onReady;
  return { player, handlers, hlsInstance, nativeEl };
}

describe('HlsPlayer live (ADR-0001 D5)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it("'auto': isLive follows data.details.live from LEVEL_LOADED, playheadDate from hls.playingDate", async () => {
    const { player, handlers, hlsInstance } = await setupLivePlayer('auto');
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);
    hlsInstance.playingDate = new Date('2026-01-01T00:00:00Z');

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: true } });

    expect(onLiveChange).toHaveBeenCalledWith(true, hlsInstance.playingDate, undefined);
  });

  // result-cycle3.md, defect 2
  it('playheadDate is null (not Invalid Date) when hls.playingDate is an Invalid Date', async () => {
    const { player, handlers, hlsInstance } = await setupLivePlayer('auto');
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);
    hlsInstance.playingDate = new Date(NaN);

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: true } });

    expect(onLiveChange).toHaveBeenCalledWith(true, null, undefined);
  });

  it("live: false never reports live, even when the manifest says so", async () => {
    const { player, handlers } = await setupLivePlayer(false);
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: true } });

    expect(onLiveChange).not.toHaveBeenCalled();
  });

  it("live: true forces isLive even when the manifest says it isn't", async () => {
    const { player, handlers } = await setupLivePlayer(true);
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: false } });

    expect(onLiveChange).toHaveBeenCalledWith(true, null, undefined);
  });

  it('streamended fires exactly once on the live -> non-live (ENDLIST) transition, not on later reloads', async () => {
    const { player, handlers } = await setupLivePlayer('auto');
    const onStreamEnded = jest.fn();
    player.onStreamEnded(onStreamEnded);
    const loaded = handlers['hlsLevelLoaded'] as LevelLoadedHandler;

    loaded(undefined, { details: { live: true } });
    loaded(undefined, { details: { live: true } }); // another reload, still live - no transition
    loaded(undefined, { details: { live: false } }); // ENDLIST appeared
    loaded(undefined, { details: { live: false } }); // stays non-live - must not re-fire

    expect(onStreamEnded).toHaveBeenCalledTimes(1);
  });

  it('goToLive() seeks to hls.liveSyncPosition while live, is a silent no-op otherwise', async () => {
    const { player, handlers, hlsInstance, nativeEl } = await setupLivePlayer('auto');
    nativeEl.currentTime = 1;

    player.goToLive(); // not live yet
    expect(nativeEl.currentTime).toBe(1);

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: true } });
    hlsInstance.liveSyncPosition = 42;
    player.goToLive();

    expect(nativeEl.currentTime).toBe(42);
  });

  // result-cycle2.md, defect 8
  it('computeLiveEdgeOffset: seekableEnd - liveSyncPosition when hls.js exposes a sync position', async () => {
    const { player, handlers, hlsInstance, nativeEl } = await setupLivePlayer('auto');
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);
    Object.defineProperty(nativeEl, 'seekable', { configurable: true, value: { length: 1, start: () => 0, end: () => 30 } });
    hlsInstance.liveSyncPosition = 24; // 6s behind the edge

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: true } });

    expect(onLiveChange).toHaveBeenCalledWith(true, null, 6);
  });

  it('computeLiveEdgeOffset: falls back to hls.targetLatency with no liveSyncPosition/seekable range yet', async () => {
    const { player, handlers, hlsInstance } = await setupLivePlayer('auto');
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);
    hlsInstance.liveSyncPosition = null;
    hlsInstance.targetLatency = 18; // e.g. 3x a 6s target duration

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: true } });

    expect(onLiveChange).toHaveBeenCalledWith(true, null, 18);
  });

  // result-cycle2.md, defect 4
  it('load() reapplies a reconfigured live option to the very next manifest report', async () => {
    const { player, handlers } = await setupLivePlayer(true); // forced live
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);

    player.load('https://example.com/b.m3u8', undefined, false); // reconfigured to off

    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { details: { live: true } });

    expect(onLiveChange).not.toHaveBeenCalled();
  });
});

// result-cycle2.md, defect 5 - LEVEL_LOADED fires per rendition, not just the
// one actually playing; a *different* level's manifest must never end/mask
// the currently active one's live state.
describe('HlsPlayer streamended: level-aware (result-cycle2.md, defect 5)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it('(a) a VOD that already starts with ENDLIST never fires streamended', async () => {
    const { player, handlers } = await setupLivePlayer('auto');
    const onStreamEnded = jest.fn();
    player.onStreamEnded(onStreamEnded);
    const loaded = handlers['hlsLevelLoaded'] as LevelLoadedHandler;

    loaded(undefined, { level: 0, details: { live: false } }); // first manifest ever seen is already static

    expect(onStreamEnded).not.toHaveBeenCalled();
  });

  it("(b) a different level loading with live:false doesn't end the currently active, still-live one", async () => {
    const { player, handlers, hlsInstance } = await setupLivePlayer('auto');
    const onStreamEnded = jest.fn();
    player.onStreamEnded(onStreamEnded);
    const loaded = handlers['hlsLevelLoaded'] as LevelLoadedHandler;
    hlsInstance.currentLevel = 0; // level A is what's actually playing

    loaded(undefined, { level: 0, details: { live: true } }); // active level A: live

    // ABR probes/queues a switch to level B - its playlist loads (and may
    // even report live:false) before the switch to it ever commits, so
    // `currentLevel` is still A.
    hlsInstance.loadLevel = 1;
    loaded(undefined, { level: 1, details: { live: false } }); // B's own manifest, unrelated to A

    expect(onStreamEnded).not.toHaveBeenCalled();
  });

  it('(c) the same level going live -> ENDLIST fires streamended exactly once', async () => {
    const { player, handlers, hlsInstance } = await setupLivePlayer('auto');
    const onStreamEnded = jest.fn();
    player.onStreamEnded(onStreamEnded);
    const loaded = handlers['hlsLevelLoaded'] as LevelLoadedHandler;
    hlsInstance.loadLevel = 0;

    loaded(undefined, { level: 0, details: { live: true } });
    loaded(undefined, { level: 0, details: { live: false } }); // ENDLIST on the active level

    expect(onStreamEnded).toHaveBeenCalledTimes(1);
  });

  it('(d) repeated LEVEL_LOADED after the end never re-fires', async () => {
    const { player, handlers, hlsInstance } = await setupLivePlayer('auto');
    const onStreamEnded = jest.fn();
    player.onStreamEnded(onStreamEnded);
    const loaded = handlers['hlsLevelLoaded'] as LevelLoadedHandler;
    hlsInstance.loadLevel = 0;

    loaded(undefined, { level: 0, details: { live: true } });
    loaded(undefined, { level: 0, details: { live: false } });
    loaded(undefined, { level: 0, details: { live: false } });
    loaded(undefined, { level: 0, details: { live: false } });

    expect(onStreamEnded).toHaveBeenCalledTimes(1);
  });
});

// result-cycle3.md, defect 3 - a LEVEL_LOADED delivered after an
// intervening load() already moved this (reused) hls.js instance onto a
// different source must never touch that new source's live state, even
// while hls.js's own currentLevel/loadLevel are still -1 (the window where
// the plain level filter alone lets anything through - see
// bindLevelLoaded()'s comment in hls-player.ts).
describe('HlsPlayer LEVEL_LOADED generation guard (result-cycle3.md, defect 3)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it('a stale LEVEL_LOADED from a superseded load() is discarded even if still invoked directly', async () => {
    const { player, handlers, hlsInstance } = await setupLivePlayer('auto', 'https://example.com/a.m3u8');
    const staleHandler = handlers['hlsLevelLoaded'] as LevelLoadedHandler;
    const onLiveChange = jest.fn();
    const onStreamEnded = jest.fn();
    player.onLiveChange(onLiveChange);
    player.onStreamEnded(onStreamEnded);

    staleHandler(undefined, { level: 0, details: { live: true } }); // A: live
    expect(onLiveChange).toHaveBeenCalledTimes(1);

    player.load('https://example.com/b.m3u8'); // supersedes A on the same hls.js instance
    // hls.js resets currentLevel/loadLevel to -1 for a fresh source until it
    // picks a level - the exact window where `activeLevel !== -1 && ...`
    // alone doesn't filter anything out.
    hlsInstance.currentLevel = -1;
    hlsInstance.loadLevel = -1;

    // A's own late event, arriving after load(B) - must be a no-op: no
    // stale isLive report, no false streamended leaking onto B.
    staleHandler(undefined, { level: 0, details: { live: false } });

    expect(onLiveChange).toHaveBeenCalledTimes(1); // still just A's
    expect(onStreamEnded).not.toHaveBeenCalled();

    // hls.off() really unsubscribed the stale closure...
    expect(hlsInstance.off).toHaveBeenCalledWith('hlsLevelLoaded', staleHandler);
    // ...and B got its own, distinct listener that works normally.
    expect(handlers['hlsLevelLoaded']).not.toBe(staleHandler);
    (handlers['hlsLevelLoaded'] as LevelLoadedHandler)(undefined, { level: -1, details: { live: true } });
    expect(onLiveChange).toHaveBeenCalledTimes(2);
    expect(onLiveChange).toHaveBeenLastCalledWith(true, null, undefined);
  });

  it('load() removes the previous generation listener instead of accumulating dead ones', async () => {
    const { hlsInstance, player } = await setupLivePlayer('auto', 'https://example.com/a.m3u8');

    player.load('https://example.com/b.m3u8');
    player.load('https://example.com/c.m3u8');

    const onCalls = (hlsInstance.on as jest.Mock).mock.calls.filter(([event]) => event === 'hlsLevelLoaded');
    const offCalls = (hlsInstance.off as jest.Mock).mock.calls.filter(([event]) => event === 'hlsLevelLoaded');
    expect(onCalls).toHaveLength(3); // one per load(): A, B, C
    expect(offCalls).toHaveLength(2); // A's and B's listeners each removed once superseded
  });
});

// result-cycle2.md, defect 1 - Safari/older Smart TVs (no MSE): hls.js
// itself never drives playback, so live must come from the shared native
// <video> detection (native-live.ts), the same one native-media-player.ts
// uses for mp4/mp3.
describe('HlsPlayer native-HLS-without-MSE fallback: live (result-cycle2.md, defect 1)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  async function setupNativeFallbackLivePlayer(liveOpt?: boolean | 'auto') {
    (window as any).Hls = jest.fn().mockImplementation(() => ({
      attachMedia: jest.fn(),
      on: jest.fn(),
      loadSource: jest.fn(),
      destroy: jest.fn(),
    }));
    (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed', LEVEL_LOADED: 'hlsLevelLoaded' };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(false);

    const nativeEl = createVideoElement();
    nativeEl.canPlayType = jest.fn().mockReturnValue('maybe');
    const player = new HlsPlayer(nativeEl, undefined, liveOpt);
    await player.onReady;
    player.load('https://example.com/live-fallback.m3u8');
    return { player, nativeEl };
  }

  function setDuration(el: HTMLVideoElement, value: number) {
    Object.defineProperty(el, 'duration', { configurable: true, value });
  }

  function setSeekable(el: HTMLVideoElement, end: number) {
    Object.defineProperty(el, 'seekable', { configurable: true, value: { length: 1, start: () => 0, end: () => end } });
  }

  it('reports isLive/playheadDate, grows the window, goToLive() seeks seekable.end(), and fires exactly one streamended', async () => {
    const { player, nativeEl } = await setupNativeFallbackLivePlayer('auto');
    const onLiveChange = jest.fn();
    const onStreamEnded = jest.fn();
    player.onLiveChange(onLiveChange);
    player.onStreamEnded(onStreamEnded);

    setSeekable(nativeEl, 10);
    setDuration(nativeEl, Infinity);
    nativeEl.dispatchEvent(new Event('durationchange'));
    expect(onLiveChange).toHaveBeenLastCalledWith(true, null, 2);

    // Window grows while still live - 'progress' now reports it too (defect 8).
    setSeekable(nativeEl, 30);
    nativeEl.dispatchEvent(new Event('progress'));
    expect(onLiveChange).toHaveBeenLastCalledWith(true, null, 2);

    Object.defineProperty(nativeEl, 'currentTime', { configurable: true, value: 0, writable: true });
    player.goToLive();
    expect(nativeEl.currentTime).toBe(30); // seekable.end() - no hls.js liveSyncPosition on this path

    setDuration(nativeEl, 42); // broadcast ends: duration leaves Infinity
    nativeEl.dispatchEvent(new Event('durationchange'));
    nativeEl.dispatchEvent(new Event('durationchange')); // must not re-fire

    expect(onStreamEnded).toHaveBeenCalledTimes(1);
  });

  it('goToLive() is a silent no-op before the stream is known to be live', async () => {
    const { player, nativeEl } = await setupNativeFallbackLivePlayer('auto');
    Object.defineProperty(nativeEl, 'currentTime', { configurable: true, value: 1, writable: true });
    setSeekable(nativeEl, 30);

    player.goToLive();

    expect(nativeEl.currentTime).toBe(1);
  });
});
