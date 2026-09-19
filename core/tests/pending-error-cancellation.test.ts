import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { UltraMediaCore } from '../src/core/ultra-media-core';

// Real UltraMediaCore + real PlayerFactory here - not the
// PlayerFactory.create mock tests/ultra-media-core.test.ts uses - because
// this exercises the exact concrete path cycle 3, defect 3 named:
// player-factory.ts's CONTAINER_REQUIRED stub defers its error onto a
// microtask without checking UltraMediaCore's generation/destroyed state,
// so it used to reach `error` even after the load it belongs to was
// destroyed or superseded.
function video(): HTMLVideoElement {
  return document.createElement('video');
}

describe('UltraMediaCore: a CONTAINER_REQUIRED error superseded/destroyed before it fires never reaches the host (cycle 3, defect 3)', () => {
  it('destroy() right after load(youtubeUrl) with no container emits no error', async () => {
    const core = new UltraMediaCore(video()); // no `container` option - YouTube always hits CONTAINER_REQUIRED here
    const errorHandler = jest.fn();
    core.addEventListener('error', errorHandler);

    core.load('https://www.youtube.com/watch?v=VIDEO_ID12');
    core.destroy();

    // Let the deferred (microtask) CONTAINER_REQUIRED error actually fire.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorHandler).not.toHaveBeenCalled();
  });

  it('load(youtubeUrl) immediately superseded by load(mp4) emits no error for the stale youtube load', async () => {
    const core = new UltraMediaCore(video());
    const errorHandler = jest.fn();
    core.addEventListener('error', errorHandler);

    core.load('https://www.youtube.com/watch?v=VIDEO_ID12'); // no container -> CONTAINER_REQUIRED, deferred
    core.load('https://example.com/a.mp4'); // supersedes before the deferred error fires

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorHandler).not.toHaveBeenCalled();
  });
});

describe('UltraMediaCore: a late engine error after destroy() never reaches the host (cycle 3, defect 3)', () => {
  afterEach(() => {
    delete (window as any).Hls;
  });

  it('an hls.js ERROR event that fires after destroy() is not emitted', async () => {
    let trigger: (event: unknown, data: any) => void = () => {};
    (window as any).Hls = jest.fn().mockImplementation(() => ({
      attachMedia: jest.fn(),
      on: jest.fn((event: string, cb: any) => { if (event === 'hlsError') trigger = cb; }),
      loadSource: jest.fn(),
      destroy: jest.fn(),
    }));
    (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);

    const core = new UltraMediaCore(video());
    const errorHandler = jest.fn();
    core.addEventListener('error', errorHandler);

    core.load('https://example.com/master.m3u8');
    await core.ready;

    core.destroy();
    trigger(null, { type: 'networkError', details: 'manifestLoadError', fatal: true, url: 'https://example.com/master.m3u8' });

    expect(errorHandler).not.toHaveBeenCalled();
  });
});
