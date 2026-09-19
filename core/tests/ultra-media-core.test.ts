import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { UltraMediaCore } from '../src/core/ultra-media-core';
import { PlayerFactory } from '../src/core/player-factory';
import type { IMediaPlayer, MediaPlayerError, MediaTracks } from '../src/core/media-player';

// UltraMediaCore has zero dependency on super-media-element/media-tracks -
// only PlayerFactory needs mocking here (same tracking-stub pattern the
// pre-extraction element tests already used), so this file needs none of
// the base-class stand-ins ultra-media-element-lifecycle.test.ts does.
jest.mock('../src/core/player-factory', () => {
  const actual = jest.requireActual('../src/core/player-factory') as any;
  return { ...actual, PlayerFactory: { create: jest.fn() } };
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type FakePlayer = IMediaPlayer & {
  load: jest.Mock;
  destroy: jest.Mock;
  switchAudioTrack: jest.Mock;
  switchRendition: jest.Mock;
  emitError: (e: MediaPlayerError) => void;
  emitTracks: (t: MediaTracks) => void;
};

function fakePlayer(onReady: Promise<void> = Promise.resolve()): FakePlayer {
  let errorCb: ((e: MediaPlayerError) => void) | undefined;
  let tracksCb: ((t: MediaTracks) => void) | undefined;
  return {
    onReady,
    load: jest.fn(),
    destroy: jest.fn(),
    switchAudioTrack: jest.fn(),
    switchRendition: jest.fn(),
    onError: (cb) => { errorCb = cb; },
    onTracksChange: (cb) => { tracksCb = cb; },
    emitError: (e) => errorCb?.(e),
    emitTracks: (t) => tracksCb?.(t),
  };
}

function mockFactoryReturning(...players: FakePlayer[]) {
  let i = 0;
  (PlayerFactory.create as jest.Mock).mockImplementation((({ src, element, format }: any) => {
    const engineByFormat: Record<string, string> = { hls: 'hls.js', dash: 'dash.js', mp4: 'video/mp4', audio: 'audio/mp3', youtube: 'youtube' };
    element.dataset.type = engineByFormat[format] ?? (src.includes('.m3u8') ? 'hls.js' : src.includes('.mpd') ? 'dash.js' : 'video/mp4');
    return players[Math.min(i++, players.length - 1)];
  }) as any);
}

function video(): HTMLVideoElement {
  return document.createElement('video');
}

afterEach(() => {
  (PlayerFactory.create as jest.Mock).mockReset();
});

describe('UltraMediaCore: emitter', () => {
  it('addEventListener receives {type, detail}; removeEventListener stops future calls', () => {
    const core = new UltraMediaCore(video());
    const handler = jest.fn();
    core.addEventListener('sourcechange', handler);

    mockFactoryReturning(fakePlayer());
    core.load('a.mp4');
    expect(handler).toHaveBeenCalledWith({ type: 'sourcechange', detail: { src: 'a.mp4' } });

    core.removeEventListener('sourcechange', handler);
    core.load('b.mp4');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is not an EventTarget instance (ADR-0001 D2 - no EventTarget constructor)', () => {
    const core = new UltraMediaCore(video());
    expect(core).not.toBeInstanceOf(EventTarget);
  });
});

describe('UltraMediaCore: load()/destroy() lifecycle', () => {
  it('creates a player via PlayerFactory with the given element/container', () => {
    const el = video();
    const container = document.createElement('div');
    mockFactoryReturning(fakePlayer());
    const core = new UltraMediaCore(el, { container });

    core.load('a.mp4');

    expect(PlayerFactory.create).toHaveBeenCalledWith(expect.objectContaining({ src: 'a.mp4', element: el, container }));
  });

  it('reuses the current player via load() when the format is unchanged', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());

    core.load('a.mp4');
    core.load('b.mp4');

    expect(PlayerFactory.create).toHaveBeenCalledTimes(1);
    expect(player.load).toHaveBeenCalledWith('b.mp4');
  });

  it('tears down the old player and creates a new one on a format change', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    mockFactoryReturning(first, second);
    const core = new UltraMediaCore(video());

    core.load('a.mp4');
    core.load('b.m3u8');

    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(PlayerFactory.create).toHaveBeenCalledTimes(2);
    expect(core.engine).toBe('hls.js');
  });

  it('accepts an explicit { src, type } source, bypassing sniffing', () => {
    mockFactoryReturning(fakePlayer());
    const core = new UltraMediaCore(video());

    core.load({ src: 'https://example.com/stream', type: 'hls' as any });

    expect(PlayerFactory.create).toHaveBeenCalledWith(expect.objectContaining({ src: 'https://example.com/stream', format: 'hls' }));
    expect(core.format).toBe('hls');
  });

  it('destroy() tears down the player and leaves media/src/format/engine reset', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    core.load('a.mp4');

    core.destroy();

    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(core.src).toBeNull();
    expect(core.format).toBeNull();
    expect(core.engine).toBeNull();
  });

  it('destroy() is idempotent', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    core.load('a.mp4');

    core.destroy();
    core.destroy();
    core.destroy();

    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it('a destroyed core can load() again, creating a fresh player (reusable by the same core)', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    mockFactoryReturning(first, second);
    const core = new UltraMediaCore(video());

    core.load('a.mp4');
    core.destroy();
    core.load('a.mp4');

    expect(PlayerFactory.create).toHaveBeenCalledTimes(2);
    expect(core.src).toBe('a.mp4');
  });

  it('emits enginechange only when the engine actually changes', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const handler = jest.fn();
    core.addEventListener('enginechange', handler);

    core.load('a.mp4');
    expect(handler).toHaveBeenCalledTimes(1);

    core.load('b.mp4'); // same format/engine, reused player
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('UltraMediaCore: ready (settles per load(), rejects on supersede/fatal error)', () => {
  it('resolves once the engine reports ready, and emits "ready"', async () => {
    mockFactoryReturning(fakePlayer());
    const core = new UltraMediaCore(video());
    const handler = jest.fn();
    core.addEventListener('ready', handler);

    core.load('a.mp4');
    await expect(core.ready).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects the *previous* ready promise when superseded by a new load() before it settles', async () => {
    const slow = deferred<void>();
    mockFactoryReturning(fakePlayer(slow.promise), fakePlayer());
    const core = new UltraMediaCore(video());

    core.load('a.m3u8'); // slow engine, onReady not resolved yet
    const staleReady = core.ready;

    core.load('b.mp4'); // supersedes before the first ever settles

    await expect(staleReady).rejects.toThrow(/superseded/);
  });

  it('a late onReady resolution from a superseded/torn-down player does not resolve or emit "ready" for the new load', async () => {
    const slow = deferred<void>();
    mockFactoryReturning(fakePlayer(slow.promise), fakePlayer());
    const core = new UltraMediaCore(video());
    const handler = jest.fn();
    core.addEventListener('ready', handler);

    core.load('a.m3u8');
    core.load('b.mp4');
    await core.ready; // the new (b.mp4) load's ready

    // The stale hls.js SDK "finishes loading" only now - must be ignored.
    slow.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1); // only for b.mp4, not twice
  });

  it('rejects ready when a fatal error arrives before it settles', async () => {
    const slow = deferred<void>();
    const player = fakePlayer(slow.promise);
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());

    core.load('a.m3u8');
    const readyPromise = core.ready;
    player.emitError({ fatal: true, category: 'networkError', code: 'X', message: 'm', engine: 'hls.js' });

    await expect(readyPromise).rejects.toMatchObject({ fatal: true });
  });
});

describe('UltraMediaCore: error/warning routing (fatal -> error, else -> warning)', () => {
  it('emits "error" for a fatal MediaPlayerError, with the same detail', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const errorHandler = jest.fn();
    const warningHandler = jest.fn();
    core.addEventListener('error', errorHandler);
    core.addEventListener('warning', warningHandler);
    core.load('a.mp4');

    const err: MediaPlayerError = { fatal: true, category: 'networkError', code: 'X', message: 'm', engine: 'video/mp4' };
    player.emitError(err);

    expect(errorHandler).toHaveBeenCalledWith({ type: 'error', detail: err });
    expect(warningHandler).not.toHaveBeenCalled();
  });

  it('emits "warning" (not "error") for a non-fatal MediaPlayerError', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const errorHandler = jest.fn();
    const warningHandler = jest.fn();
    core.addEventListener('error', errorHandler);
    core.addEventListener('warning', warningHandler);
    core.load('a.mp4');

    const warn: MediaPlayerError = { fatal: false, category: 'networkError', code: 'X', message: 'm', engine: 'video/mp4' };
    player.emitError(warn);

    expect(warningHandler).toHaveBeenCalledWith({ type: 'warning', detail: warn });
    expect(errorHandler).not.toHaveBeenCalled();
  });
});

describe('UltraMediaCore: renditions/audioTracks from onTracksChange', () => {
  it('populates renditions/audioTracks and emits both change events', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const renditionsHandler = jest.fn();
    const audioHandler = jest.fn();
    core.addEventListener('renditionschange', renditionsHandler);
    core.addEventListener('audiotrackschange', audioHandler);
    core.load('a.m3u8');

    const tracks: MediaTracks = {
      audio: [{ id: '0', kind: 'main', label: 'English', language: 'en', default: true }],
      renditions: [{ id: '0', width: 1280, height: 720 }],
    };
    player.emitTracks(tracks);

    expect(core.audioTracks).toEqual(tracks.audio);
    expect(core.renditions).toEqual(tracks.renditions);
    expect(renditionsHandler).toHaveBeenCalledWith({ type: 'renditionschange', detail: { renditions: tracks.renditions } });
    expect(audioHandler).toHaveBeenCalledWith({ type: 'audiotrackschange', detail: { audioTracks: tracks.audio } });
  });
});

describe('UltraMediaCore: rendition/audioTrack selection by id', () => {
  it('rendition setter calls switchRendition and emits renditionchange', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    core.load('a.m3u8');
    const handler = jest.fn();
    core.addEventListener('renditionchange', handler);

    core.rendition = '1';

    expect(player.switchRendition).toHaveBeenCalledWith('1');
    expect(core.rendition).toBe('1');
    expect(handler).toHaveBeenCalledWith({ type: 'renditionchange', detail: { rendition: '1' } });
  });

  it('setting rendition to "auto" does not call switchRendition (no engine support for it today)', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    core.load('a.m3u8');

    core.rendition = 'auto';

    expect(player.switchRendition).not.toHaveBeenCalled();
    expect(core.rendition).toBe('auto');
  });

  it('audioTrack setter calls switchAudioTrack and emits audiotrackchange', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    core.load('a.m3u8');
    const handler = jest.fn();
    core.addEventListener('audiotrackchange', handler);

    core.audioTrack = '2';

    expect(player.switchAudioTrack).toHaveBeenCalledWith('2');
    expect(core.audioTrack).toBe('2');
    expect(handler).toHaveBeenCalledWith({ type: 'audiotrackchange', detail: { audioTrack: '2' } });
  });
});

describe('UltraMediaCore: stale tracks are cleared on teardown (cycle 2, defect 3)', () => {
  it('destroy() clears renditions/audioTracks and emits both change events with empty lists', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    core.load('a.m3u8');
    player.emitTracks({
      audio: [{ id: '0', kind: 'main', label: 'English', language: 'en' }],
      renditions: [{ id: '0', width: 1280, height: 720 }],
    });
    expect(core.renditions).toHaveLength(1);

    const renditionsHandler = jest.fn();
    const audioHandler = jest.fn();
    core.addEventListener('renditionschange', renditionsHandler);
    core.addEventListener('audiotrackschange', audioHandler);

    core.destroy();

    expect(core.renditions).toEqual([]);
    expect(core.audioTracks).toEqual([]);
    expect(renditionsHandler).toHaveBeenCalledWith({ type: 'renditionschange', detail: { renditions: [] } });
    expect(audioHandler).toHaveBeenCalledWith({ type: 'audiotrackschange', detail: { audioTracks: [] } });
  });

  it('a format change during load() clears the previous engine\'s tracks before the new one reports its own', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    mockFactoryReturning(first, second);
    const core = new UltraMediaCore(video());

    core.load('a.m3u8'); // hls
    first.emitTracks({
      audio: [{ id: '0', kind: 'main', label: 'English', language: 'en' }],
      renditions: [{ id: '0', width: 1280, height: 720 }],
    });
    expect(core.renditions).toHaveLength(1);

    const renditionsHandler = jest.fn();
    core.addEventListener('renditionschange', renditionsHandler);

    core.load('b.mp4'); // native player - never reports onTracksChange

    // Cleared immediately by the teardown, not left over from hls.
    expect(core.renditions).toEqual([]);
    expect(core.audioTracks).toEqual([]);
    expect(renditionsHandler).toHaveBeenCalledWith({ type: 'renditionschange', detail: { renditions: [] } });
  });
});

describe('UltraMediaCore: leaves the <video> as it found it, except src (cycle 2, defect 4)', () => {
  it('destroy() removes the data-type attribute PlayerFactory wrote', () => {
    const player = fakePlayer();
    mockFactoryReturning(player); // writes element.dataset.type, same as the real PlayerFactory
    const el = video();
    const core = new UltraMediaCore(el);

    core.load('a.mp4');
    expect(el.dataset.type).toBe('video/mp4');

    core.destroy();
    expect(el.dataset.type).toBeUndefined();
  });

  it('a second UltraMediaCore on an already-attached <video> throws a clear error', () => {
    const el = video();
    // eslint-disable-next-line no-new
    new UltraMediaCore(el);

    expect(() => new UltraMediaCore(el)).toThrow(/already attached/);
  });

  it('sequential use (destroy() then a new UltraMediaCore on the same <video>) still works', () => {
    const el = video();
    const first = new UltraMediaCore(el);
    first.destroy();

    expect(() => new UltraMediaCore(el)).not.toThrow();
  });
});
