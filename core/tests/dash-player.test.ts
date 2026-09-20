import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { DashPlayer } from '../src/players/dash-player';
import type { MediaTracks } from '../src/core/media-player';
import type { RequestPolicy } from '../src/core/request-policy';

function createVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

// The real numeric values dash.js 5.2.1 exports as `MediaPlayer.errors`
// (node_modules/dashjs/index.d.ts `MediaPlayerErrors`) - fixed values, not
// derived, so a test using the wrong number here would silently pass.
const DASHJS_ERRORS = {
  MANIFEST_LOADER_PARSING_FAILURE_ERROR_CODE: 10,
  MANIFEST_LOADER_LOADING_FAILURE_ERROR_CODE: 11,
  XLINK_LOADER_LOADING_FAILURE_ERROR_CODE: 12,
  SEGMENT_BASE_LOADER_ERROR_CODE: 15,
  TIME_SYNC_FAILED_ERROR_CODE: 16,
  FRAGMENT_LOADER_LOADING_FAILURE_ERROR_CODE: 17,
  FRAGMENT_LOADER_NULL_REQUEST_ERROR_CODE: 18,
  URL_RESOLUTION_FAILED_GENERIC_ERROR_CODE: 19,
  APPEND_ERROR_CODE: 20,
  REMOVE_ERROR_CODE: 21,
  DATA_UPDATE_FAILED_ERROR_CODE: 22,
  CAPABILITY_MEDIASOURCE_ERROR_CODE: 23,
  CAPABILITY_MEDIAKEYS_ERROR_CODE: 24,
  DOWNLOAD_ERROR_ID_MANIFEST_CODE: 25,
  DOWNLOAD_ERROR_ID_SIDX_CODE: 26,
  DOWNLOAD_ERROR_ID_CONTENT_CODE: 27,
  DOWNLOAD_ERROR_ID_INITIALIZATION_CODE: 28,
  DOWNLOAD_ERROR_ID_XLINK_CODE: 29,
  MANIFEST_ERROR_ID_PARSE_CODE: 31,
  MANIFEST_ERROR_ID_NOSTREAMS_CODE: 32,
  TIMED_TEXT_ERROR_ID_PARSE_CODE: 33,
  MANIFEST_ERROR_ID_MULTIPLEXED_CODE: 34,
  MEDIASOURCE_TYPE_UNSUPPORTED_CODE: 35,
};

const FAKE_REPRESENTATIONS = [
  { width: 480, height: 270, bandwidth: 173100, frameRate: 12, codecs: 'avc1.42c01f' },
  { width: 320, height: 180, bandwidth: 80822, frameRate: 12, codecs: 'avc1.42c015' },
];

function setupMocks() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const mockPlayerInstance = {
    initialize: jest.fn(),
    updateSettings: jest.fn(),
    on: jest.fn((event: string, cb: (...args: any[]) => void) => {
      handlers[event] = cb;
    }),
    getTracksFor: jest.fn().mockReturnValue([]),
    getRepresentationsByType: jest.fn().mockReturnValue(FAKE_REPRESENTATIONS),
    setRepresentationForTypeByIndex: jest.fn(),
    setCurrentTrack: jest.fn(),
    attachSource: jest.fn(),
    addRequestInterceptor: jest.fn(),
    removeRequestInterceptor: jest.fn(),
    destroy: jest.fn(),
  };

  const MediaPlayerFactory: any = jest.fn(() => ({ create: () => mockPlayerInstance }));
  MediaPlayerFactory.events = { ERROR: 'error', STREAM_INITIALIZED: 'streamInitialized' };
  MediaPlayerFactory.errors = DASHJS_ERRORS;

  (window as any).dashjs = { MediaPlayer: MediaPlayerFactory };

  return { handlers, mockPlayerInstance };
}

async function setupPlayer() {
  const { handlers, mockPlayerInstance } = setupMocks();
  const nativeEl = createVideoElement();
  const player = new DashPlayer(nativeEl);
  await player.onReady;
  return { player, handlers, mockPlayerInstance, nativeEl };
}

function fakeMediaError(code: number, message = ''): MediaError {
  return { code, message, MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 } as MediaError;
}

describe('DashPlayer renditions', () => {
  afterEach(() => {
    delete (window as any).dashjs;
  });

  it('exposes one videoRendition per bitrate Representation, not per AdaptationSet', async () => {
    const { player, handlers } = await setupPlayer();
    const onTracksChange = jest.fn<(tracks: MediaTracks) => void>();
    player.onTracksChange(onTracksChange);

    handlers.streamInitialized();

    expect(onTracksChange).toHaveBeenCalledTimes(1);
    const tracks = onTracksChange.mock.calls[0][0] as MediaTracks;
    expect(tracks.renditions).toEqual([
      { id: '0', width: 480, height: 270, bitrate: 173100, frameRate: 12, codec: 'avc1.42c01f' },
      { id: '1', width: 320, height: 180, bitrate: 80822, frameRate: 12, codec: 'avc1.42c015' },
    ]);
  });

  it('switchRendition selects by the same index getRepresentationsByType returned', async () => {
    const { player, handlers, mockPlayerInstance } = await setupPlayer();
    player.onTracksChange(jest.fn());
    handlers.streamInitialized();

    player.switchRendition('1');

    expect(mockPlayerInstance.setRepresentationForTypeByIndex).toHaveBeenCalledWith('video', 1);
  });
});

describe('DashPlayer error mapping', () => {
  afterEach(() => {
    delete (window as any).dashjs;
  });

  it('maps a manifest download failure (code 25) to fatal:true', async () => {
    const { player, handlers } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    handlers.error({
      error: {
        code: DASHJS_ERRORS.DOWNLOAD_ERROR_ID_MANIFEST_CODE,
        message: 'manifest.mpd is not available',
        data: {
          request: { url: 'https://example.com/manifest.mpd' },
          response: { status: 404, url: 'https://example.com/manifest.mpd' },
        },
      },
    });

    expect(onError).toHaveBeenCalledWith({
      fatal: true,
      category: 'networkError',
      code: '25',
      message: 'manifest.mpd is not available',
      engine: 'dash.js',
      url: 'https://example.com/manifest.mpd',
      status: 404,
      cause: expect.any(Object),
    });
  });

  // Was previously classified fatal:false ("a single segment can fail, ABR
  // routes around it"). Reclassified per the cycle-2 review: dash.js's
  // HTTPLoader only raises DOWNLOAD_ERROR_ID_CONTENT/INITIALIZATION/SIDX
  // (27/28/26) via `_retriggerRequest` once ITS OWN internal retry budget
  // (mediaPlayerModel.getRetryAttemptsForType) is already exhausted
  // (dash.all.debug.js ~59856-59863, ~60075-60102) - by the time this event
  // reaches us, dash.js has already given up on that resource, so playback
  // is stalled, not routing around it. See categorizeDashError's comment.
  it('maps a media segment download failure (code 27) to fatal:true - dash.js only raises this after exhausting its own retries', async () => {
    const { player, handlers } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    handlers.error({
      error: {
        code: DASHJS_ERRORS.DOWNLOAD_ERROR_ID_CONTENT_CODE,
        message: 'segment-3.m4s is not available',
        data: { request: { url: 'https://example.com/segment-3.m4s' }, response: { status: 500 } },
      },
    });

    expect(onError.mock.calls[0][0]).toMatchObject({ fatal: true, category: 'networkError' });
  });

  it('maps an init segment download failure (code 28) to fatal:true, same reasoning as code 27', async () => {
    const { player, handlers } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    handlers.error({
      error: { code: DASHJS_ERRORS.DOWNLOAD_ERROR_ID_INITIALIZATION_CODE, message: 'init.mp4 is not available', data: {} },
    });

    expect(onError.mock.calls[0][0]).toMatchObject({ fatal: true, category: 'networkError' });
  });

  it('maps a sidx download failure (code 26) to fatal:true, same reasoning as code 27', async () => {
    const { player, handlers } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    handlers.error({
      error: { code: DASHJS_ERRORS.DOWNLOAD_ERROR_ID_SIDX_CODE, message: 'sidx is not available', data: {} },
    });

    expect(onError.mock.calls[0][0]).toMatchObject({ fatal: true, category: 'networkError' });
  });

  // A code from a genuinely single-shot path (no exhausted-retry
  // precondition, unlike 26/27/28 above) stays recoverable.
  it('still maps a segment-base-loader failure (code 15) to fatal:false', async () => {
    const { player, handlers } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    handlers.error({
      error: { code: DASHJS_ERRORS.SEGMENT_BASE_LOADER_ERROR_CODE, message: 'segment base not found', data: {} },
    });

    expect(onError.mock.calls[0][0]).toMatchObject({ fatal: false });
  });

  it('maps an MSE/buffer failure (code 20) to category:mediaError, fatal:true', async () => {
    const { player, handlers } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    handlers.error({
      error: { code: DASHJS_ERRORS.APPEND_ERROR_CODE, message: 'append failed', data: {} },
    });

    expect(onError.mock.calls[0][0]).toMatchObject({ fatal: true, category: 'mediaError' });
  });
});

describe('DashPlayer native <video> error forwarding', () => {
  afterEach(() => {
    delete (window as any).dashjs;
  });

  it('translates a native <video> error into a fatal error through the same callback', async () => {
    const { player, nativeEl } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    Object.defineProperty(nativeEl, 'error', { value: fakeMediaError(3, 'decode failed'), configurable: true });
    nativeEl.dispatchEvent(new Event('error'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      fatal: true,
      category: 'mediaError',
      code: 'MEDIA_ERR_DECODE',
      engine: 'dash.js',
    });
  });

  // dash.js re-emits a native MediaError through its OWN `MediaPlayer.events.
  // ERROR` too (see dash-player.ts's ERROR handler comment) - using the
  // native code (1-5) as `err.code`. Simulates both firing for the same
  // underlying failure and asserts exactly one `error` reaches the element.
  it('does not double-report when dash.js also re-emits the native error via its own ERROR event', async () => {
    const { player, handlers, nativeEl } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    Object.defineProperty(nativeEl, 'error', { value: fakeMediaError(3, 'decode failed'), configurable: true });
    nativeEl.dispatchEvent(new Event('error'));
    handlers.error({ error: { code: 3, message: 'MEDIA_ERR_DECODE (decode failed)' } });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  // A new load resets `element.error` to null, so an `error` event still
  // queued for the superseded source arrives with no MediaError - it must
  // not be reported as the current load's failure.
  it('ignores a stale native error event that carries no MediaError', async () => {
    const { player, nativeEl } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    Object.defineProperty(nativeEl, 'error', { value: null, configurable: true });
    nativeEl.dispatchEvent(new Event('error'));

    expect(onError).not.toHaveBeenCalled();
  });

  it('stops listening for the native error once destroyed (no spurious event on teardown)', async () => {
    const { player, nativeEl } = await setupPlayer();
    const onError = jest.fn();
    player.onError(onError);

    player.destroy();

    Object.defineProperty(nativeEl, 'error', { value: fakeMediaError(2), configurable: true });
    nativeEl.dispatchEvent(new Event('error'));

    expect(onError).not.toHaveBeenCalled();
  });
});

// Same System.import-based deferred-load trick as hls-player.test.ts - see
// its comment for why jest.isolateModulesAsync is needed alongside it.
function deferredDashImport() {
  let resolveImport: (mod: { default: any }) => void = () => {};
  (window as any).System = {
    import: jest.fn().mockReturnValue(new Promise((resolve) => { resolveImport = resolve as any; })),
  };

  const attachSource = jest.fn();
  const mockPlayerInstance = {
    initialize: jest.fn(),
    updateSettings: jest.fn(),
    on: jest.fn(),
    attachSource,
    addRequestInterceptor: jest.fn(),
    removeRequestInterceptor: jest.fn(),
    destroy: jest.fn(),
  };
  const MediaPlayerFactory: any = jest.fn(() => ({ create: () => mockPlayerInstance }));
  MediaPlayerFactory.events = { ERROR: 'error', STREAM_INITIALIZED: 'streamInitialized' };
  MediaPlayerFactory.errors = DASHJS_ERRORS;
  const dashjsModule = { MediaPlayer: MediaPlayerFactory };

  return {
    attachSource,
    MediaPlayerFactory,
    resolve: () => {
      (window as any).dashjs = dashjsModule;
      resolveImport({ default: dashjsModule });
    },
  };
}

async function withDeferredDashPlayer(
  run: (ctx: { DashPlayer: typeof DashPlayer } & ReturnType<typeof deferredDashImport>) => Promise<void>
): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    const freshModule = require('../src/players/dash-player');
    await run({ DashPlayer: freshModule.DashPlayer, ...deferredDashImport() });
  });
}

describe('DashPlayer cancellation (destroy()/rapid src swap during SDK load)', () => {
  afterEach(() => {
    delete (window as any).System;
    delete (window as any).dashjs;
  });

  // Same race as HlsPlayer's: player-factory.ts:64 used to keep
  // `onReady.then(() => player.load(src))` alive even after destroy() ran,
  // so once the CDN script finally loaded, dash.js still got instantiated
  // and started fetching the (by then cancelled) source.
  it('never creates the dash.js MediaPlayer instance if destroy() runs before the SDK finishes loading', async () => {
    await withDeferredDashPlayer(async ({ DashPlayer: FreshDashPlayer, MediaPlayerFactory, resolve }) => {
      const player = new FreshDashPlayer(createVideoElement());
      player.load('https://example.com/manifest.mpd');
      player.destroy();

      resolve();
      await player.onReady;

      expect(MediaPlayerFactory).not.toHaveBeenCalled();
    });
  });

  it('applies only the last load() requested before the SDK finished loading', async () => {
    await withDeferredDashPlayer(async ({ DashPlayer: FreshDashPlayer, attachSource, resolve }) => {
      const player = new FreshDashPlayer(createVideoElement());
      player.load('https://example.com/a.mpd');
      player.load('https://example.com/b.mpd');
      player.load('https://example.com/c.mpd');

      resolve();
      await player.onReady;

      expect(attachSource).toHaveBeenCalledTimes(1);
      expect(attachSource).toHaveBeenCalledWith('https://example.com/c.mpd');
    });
  });
});

// ADR-0001 D4 - setupMocks()'s mockPlayerInstance.addRequestInterceptor
// records the interceptor DashPlayer registers, so tests can invoke it
// directly with a fake CommonMediaRequest, the same shape dash.js's own
// HTTPLoader builds (url/headers/credentials + customData.request.type -
// confirmed by reading dist/modern/umd/dash.all.debug.js, see dash-player.ts).
async function setupPlayerWithInterceptor(requestPolicy?: RequestPolicy) {
  const { handlers, mockPlayerInstance } = setupMocks();
  const nativeEl = createVideoElement();
  const player = new DashPlayer(nativeEl, requestPolicy);
  await player.onReady;
  const interceptor = (mockPlayerInstance.addRequestInterceptor as jest.Mock).mock.calls[0][0];
  return { player, handlers, mockPlayerInstance, interceptor };
}

function fakeRequest(url: string, type: string, headers?: Record<string, string>) {
  return { url, headers, customData: { request: { type } } };
}

describe('DashPlayer request policy (ADR-0001 D4)', () => {
  afterEach(() => {
    delete (window as any).dashjs;
  });

  it('applies static headers, classified by dash.js\'s internal HTTPRequest.type', async () => {
    const { interceptor } = await setupPlayerWithInterceptor({ headers: { Authorization: 'Bearer t' } });
    const request = fakeRequest('https://example.com/manifest.mpd', 'MPD');

    await interceptor(request);

    expect(request.headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('classifies MPD/segment/license request types', async () => {
    const headers = jest.fn().mockReturnValue({});
    const { interceptor } = await setupPlayerWithInterceptor({ headers });

    await interceptor(fakeRequest('m', 'MPD'));
    await interceptor(fakeRequest('s', 'MediaSegment'));
    await interceptor(fakeRequest('i', 'InitializationSegment'));
    await interceptor(fakeRequest('l', 'license'));
    await interceptor(fakeRequest('o', 'ContentSteering'));

    expect(headers.mock.calls.map((c: any) => c[0].type)).toEqual(['manifest', 'segment', 'segment', 'license', 'other']);
  });

  it('a headers function is called once per request with the classified context', async () => {
    const headers = jest.fn().mockReturnValue({ Authorization: 'Bearer t' });
    const { interceptor } = await setupPlayerWithInterceptor({ headers });

    await interceptor(fakeRequest('https://example.com/seg1.m4s', 'MediaSegment'));
    await interceptor(fakeRequest('https://example.com/seg2.m4s', 'MediaSegment'));

    expect(headers).toHaveBeenCalledTimes(2);
    expect(headers).toHaveBeenCalledWith({ url: 'https://example.com/seg1.m4s', type: 'segment', engine: 'dash.js' });
  });

  it('transformUrl runs before headers(ctx), which sees the transformed URL; credentials is set directly on the request', async () => {
    const headers = jest.fn().mockReturnValue({});
    const { interceptor } = await setupPlayerWithInterceptor({
      transformUrl: (ctx) => ctx.url + '?sig=1',
      headers,
      credentials: 'include',
    });
    const request = fakeRequest('https://example.com/manifest.mpd', 'MPD');

    const result = await interceptor(request);

    expect(result.url).toBe('https://example.com/manifest.mpd?sig=1');
    expect(result.credentials).toBe('include');
    expect(headers).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/manifest.mpd?sig=1' }));
  });

  it('a throwing headers()/transformUrl() reports REQUEST_POLICY_ERROR through onError instead of rejecting', async () => {
    const { player, interceptor } = await setupPlayerWithInterceptor({
      transformUrl: () => { throw new Error('boom'); },
    });
    const onError = jest.fn();
    player.onError(onError);

    const result = await interceptor(fakeRequest('https://example.com/manifest.mpd', 'MPD'));

    expect(result).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, code: 'REQUEST_POLICY_ERROR', engine: 'dash.js' }));
  });

  it('a later load() with a different request policy changes what the next request carries, without recreating the dash.js instance', async () => {
    const { player, interceptor, mockPlayerInstance } = await setupPlayerWithInterceptor({ headers: { Authorization: 'Bearer old' } });

    player.load('https://example.com/manifest.mpd', { headers: { Authorization: 'Bearer new' } });

    const request = fakeRequest('https://example.com/manifest.mpd', 'MPD');
    await interceptor(request);

    expect(request.headers).toEqual({ Authorization: 'Bearer new' });
    expect(mockPlayerInstance.attachSource).toHaveBeenCalledTimes(1);
  });

  it('destroy() removes the registered interceptor', async () => {
    const { player, mockPlayerInstance, interceptor } = await setupPlayerWithInterceptor({ headers: { Authorization: 'Bearer t' } });

    player.destroy();

    expect(mockPlayerInstance.removeRequestInterceptor).toHaveBeenCalledWith(interceptor);
  });
});
