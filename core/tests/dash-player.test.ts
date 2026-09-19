import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { DashPlayer } from '../src/players/dash-player';
import type { MediaTracks } from '../src/core/media-player';

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
  };

  const MediaPlayerFactory: any = jest.fn(() => ({ create: () => mockPlayerInstance }));
  MediaPlayerFactory.events = { ERROR: 'error', STREAM_INITIALIZED: 'streamInitialized' };
  MediaPlayerFactory.errors = DASHJS_ERRORS;

  (window as any).dashjs = { MediaPlayer: MediaPlayerFactory };

  return { handlers, mockPlayerInstance };
}

async function setupPlayer() {
  const { handlers, mockPlayerInstance } = setupMocks();
  const player = new DashPlayer(createVideoElement());
  await player.onReady;
  return { player, handlers, mockPlayerInstance };
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

  it('maps a single media segment download failure (code 27) to fatal:false', async () => {
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

    expect(onError.mock.calls[0][0]).toMatchObject({ fatal: false, category: 'networkError' });
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
