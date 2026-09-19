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
