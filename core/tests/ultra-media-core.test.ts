import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { UltraMediaCore } from '../src/core/ultra-media-core';
import { PlayerFactory } from '../src/core/player-factory';
import type { IMediaPlayer, MediaPlayerError, MediaTracks } from '../src/core/media-player';

// UltraMediaCore has zero dependency on the element shell's base class or
// media-tracks - only PlayerFactory needs mocking here (same tracking-stub pattern the
// pre-extraction element tests already used), so this file needs none of
// the base-class stand-ins ultra-media-element-lifecycle.test.ts does.
jest.mock('../src/core/player-factory', () => {
  const actual = jest.requireActual('../src/core/player-factory') as any;
  // resolveEngine() stays real - UltraMediaCore.load() calls it directly
  // (cycle 3, defect 1) to learn the engine name without reading it back
  // off the DOM, so it needs the actual format-detection logic, not a mock.
  return { ...actual, PlayerFactory: { create: jest.fn(), resolveEngine: actual.PlayerFactory.resolveEngine } };
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
  goToLive: jest.Mock;
  emitError: (e: MediaPlayerError) => void;
  emitTracks: (t: MediaTracks) => void;
  emitLive: (isLive: boolean, playheadDate?: Date | null) => void;
  emitStreamEnded: () => void;
};

function fakePlayer(onReady: Promise<void> = Promise.resolve()): FakePlayer {
  let errorCb: ((e: MediaPlayerError) => void) | undefined;
  let tracksCb: ((t: MediaTracks) => void) | undefined;
  let liveCb: ((isLive: boolean, playheadDate: Date | null) => void) | undefined;
  let endedCb: (() => void) | undefined;
  return {
    onReady,
    load: jest.fn(),
    destroy: jest.fn(),
    switchAudioTrack: jest.fn(),
    switchRendition: jest.fn(),
    goToLive: jest.fn(),
    onError: (cb) => { errorCb = cb; },
    onTracksChange: (cb) => { tracksCb = cb; },
    onLiveChange: (cb) => { liveCb = cb; },
    onStreamEnded: (cb) => { endedCb = cb; },
    emitError: (e) => errorCb?.(e),
    emitTracks: (t) => tracksCb?.(t),
    emitLive: (isLive, playheadDate = null) => liveCb?.(isLive, playheadDate),
    emitStreamEnded: () => endedCb?.(),
  };
}

function withSeekable(el: HTMLVideoElement, start: number, end: number, currentTime = end) {
  Object.defineProperty(el, 'seekable', { configurable: true, value: { length: 1, start: () => start, end: () => end } });
  Object.defineProperty(el, 'currentTime', { configurable: true, value: currentTime, writable: true });
}

function mockFactoryReturning(...players: FakePlayer[]) {
  let i = 0;
  // Doesn't touch `element.dataset.type` - the real PlayerFactory.create()
  // doesn't either any more (cycle 3, defect 1); `core.engine` comes from
  // the real (unmocked) PlayerFactory.resolveEngine() instead, exercised
  // for real by these tests too.
  (PlayerFactory.create as jest.Mock).mockImplementation((() => {
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
    // Second arg is the active request policy (ADR-0001 D4) - undefined
    // here since none was configured.
    expect(player.load).toHaveBeenCalledWith('b.mp4', undefined);
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

describe('UltraMediaCore: superseded/destroyed loads never emit error/warning (cycle 3, defect 3)', () => {
  it('a fatal error arriving after destroy() is not emitted', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const errorHandler = jest.fn();
    const warningHandler = jest.fn();
    core.addEventListener('error', errorHandler);
    core.addEventListener('warning', warningHandler);
    core.load('a.mp4');

    core.destroy();
    player.emitError({ fatal: true, category: 'otherError', code: 'LATE', message: 'late', engine: 'video/mp4' });

    expect(errorHandler).not.toHaveBeenCalled();
    expect(warningHandler).not.toHaveBeenCalled();
  });

  it('a non-fatal error arriving after destroy() is not emitted either', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const warningHandler = jest.fn();
    core.addEventListener('warning', warningHandler);
    core.load('a.mp4');

    core.destroy();
    player.emitError({ fatal: false, category: 'otherError', code: 'LATE', message: 'late', engine: 'video/mp4' });

    expect(warningHandler).not.toHaveBeenCalled();
  });

  it('an error from a load() already superseded by a newer load() is not emitted, but the new load\'s errors still are', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    mockFactoryReturning(first, second);
    const core = new UltraMediaCore(video());
    const errorHandler = jest.fn();
    core.addEventListener('error', errorHandler);

    core.load('a.m3u8'); // first player
    core.load('b.mp4'); // format change -> teardownPlayer() destroys `first`, wires `second`

    first.emitError({ fatal: true, category: 'otherError', code: 'STALE', message: 'stale', engine: 'hls.js' });
    expect(errorHandler).not.toHaveBeenCalled();

    second.emitError({ fatal: true, category: 'otherError', code: 'FRESH', message: 'fresh', engine: 'video/mp4' });
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith({ type: 'error', detail: expect.objectContaining({ code: 'FRESH' }) });
  });

  it('same-format reload (player reused) still lets a later error through - the guard only blocks stale generations', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const errorHandler = jest.fn();
    core.addEventListener('error', errorHandler);

    core.load('a.mp4');
    core.load('b.mp4'); // same format - player reused, generation still bumps, wireUp() re-registers onError

    player.emitError({ fatal: true, category: 'otherError', code: 'X', message: 'm', engine: 'video/mp4' });
    expect(errorHandler).toHaveBeenCalledTimes(1);
  });
});

describe('UltraMediaCore: leaves the <video> as it found it, except src (cycle 2 defect 4, cycle 3 defect 1)', () => {
  // cycle 3, defect 1: PlayerFactory used to write `element.dataset.type`
  // (later deleted by teardownPlayer()) as its only way to report the
  // engine back to UltraMediaCore - on a host `<video>` that already had
  // its own `data-type` attribute for unrelated reasons, this clobbered it
  // and then deleted it outright, instead of restoring the host's original
  // value. The core now learns the engine directly from
  // PlayerFactory.resolveEngine(), the same resolution create() itself
  // used, and never touches data-* on the element at all.
  it('never writes a data-type attribute on the host <video> - core.engine is the source of truth, not the DOM', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const el = video();
    const core = new UltraMediaCore(el);

    core.load('a.mp4');
    expect(el.dataset.type).toBeUndefined();
    expect(core.engine).toBe('video/mp4');

    core.destroy();
    expect(el.dataset.type).toBeUndefined();
  });

  it("preserves a data-* attribute the host set before attaching, through load() and destroy()", () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const el = video();
    el.dataset.type = 'do-host';
    const core = new UltraMediaCore(el);

    core.load('a.mp4');
    expect(el.dataset.type).toBe('do-host');

    core.destroy();
    expect(el.dataset.type).toBe('do-host');
  });

  // The core itself never writes inline style on the host's element: only a
  // player that changes it (YouTubePlayer, hiding the native <video> behind
  // its iframe) undoes its own write - see youtube-player.test.ts. A
  // constructor-time snapshot restored here used to clobber a change the
  // host made while the core was attached.
  it("keeps a style.display change the host made while attached (destroy())", () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const el = video();
    el.style.display = 'block';
    const core = new UltraMediaCore(el);

    core.load('a.mp4');
    el.style.display = 'flex'; // the host's own change, mid-playback

    core.destroy();
    expect(el.style.display).toBe('flex');
  });

  it('keeps a host style.display change on a format swap too, and never adds a style attribute of its own', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    mockFactoryReturning(first, second);
    const el = video();
    const core = new UltraMediaCore(el);

    core.load('a.m3u8');
    core.load('b.mp4'); // format change -> teardownPlayer()
    expect(el.hasAttribute('style')).toBe(false);

    el.style.display = 'flex';
    core.destroy();
    expect(el.style.display).toBe('flex');
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

// ADR-0001 D4 - configure() merges into options and only takes effect
// starting with the next load(): an in-progress/already-created player keeps
// whatever policy was active when its own load() call ran.
describe('UltraMediaCore: configure() (ADR-0001 D4)', () => {
  it('a request policy set at construction is passed to PlayerFactory.create() and to load()', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const policy = { credentials: 'include' as const };
    const core = new UltraMediaCore(video(), { request: policy });

    core.load('a.mp4');

    expect(PlayerFactory.create).toHaveBeenCalledWith(expect.objectContaining({ requestPolicy: policy }));
  });

  it('configure() does not affect a player already created by an earlier load() until the next load()', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());

    core.load('a.mp4');
    core.configure({ request: { credentials: 'include' } });

    // No new load() happened yet - the already-active player's load() was
    // never called again with the new policy.
    expect(player.load).toHaveBeenCalledTimes(0);
  });

  it('configure() changes the policy used starting with the very next load() (same engine, reused player)', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());
    const policy = { credentials: 'include' as const };

    core.load('a.mp4');
    core.configure({ request: policy });
    core.load('b.mp4');

    // The mocked PlayerFactory.create() (unlike the real one) doesn't call
    // player.load() itself, so the first load() leaves no call here - only
    // the reuse-branch call from the second load() does.
    expect(player.load).toHaveBeenCalledTimes(1);
    expect(player.load).toHaveBeenCalledWith('b.mp4', policy);
  });

  it('configure() changes the policy used by a brand new player on a format change', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    mockFactoryReturning(first, second);
    const core = new UltraMediaCore(video());
    const policy = { credentials: 'include' as const };

    core.load('a.mp4');
    core.configure({ request: policy });
    core.load('b.m3u8');

    expect(PlayerFactory.create).toHaveBeenLastCalledWith(expect.objectContaining({ requestPolicy: policy }));
  });
});

describe('UltraMediaCore: live (ADR-0001 D5)', () => {
  it('defaults to a neutral snapshot before any load()', () => {
    const core = new UltraMediaCore(video());
    expect(core.live).toEqual({ isLive: false, seekableStart: 0, seekableEnd: 0, liveEdge: 0, dvr: false, playheadDate: null });
  });

  it('options.live is passed to PlayerFactory.create() as-is (\'auto\' default)', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video(), { live: true });

    core.load('live.m3u8');

    expect(PlayerFactory.create).toHaveBeenCalledWith(expect.objectContaining({ live: true }));
  });

  it('onLiveChange builds LiveInfo from media.seekable/currentTime, and emits livechange', () => {
    const el = video();
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(el);
    const handler = jest.fn();
    core.addEventListener('livechange', handler);

    core.load('live.m3u8');
    withSeekable(el, 0, 20, 18);
    player.emitLive(true, new Date('2026-01-01T00:00:00Z'));

    expect(core.live).toEqual({
      isLive: true, seekableStart: 0, seekableEnd: 20, liveEdge: 20,
      dvr: false, // 20s window, under the 30s threshold
      playheadDate: new Date('2026-01-01T00:00:00Z'),
    });
    expect(handler).toHaveBeenCalledWith({ type: 'livechange', detail: core.live });
  });

  it('dvr is true once the seekable window exceeds the 30s threshold', () => {
    const el = video();
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(el);

    core.load('live.m3u8');
    withSeekable(el, 0, 45);
    player.emitLive(true, null);

    expect(core.live.dvr).toBe(true);
  });

  it('onStreamEnded flips isLive to false, emits livechange then streamended, in that order', () => {
    const el = video();
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(el);
    const order: string[] = [];
    core.addEventListener('livechange', () => order.push('livechange'));
    core.addEventListener('streamended', () => order.push('streamended'));

    core.load('live.m3u8');
    withSeekable(el, 0, 20);
    player.emitLive(true, null);
    player.emitStreamEnded();

    expect(core.live.isLive).toBe(false);
    expect(order).toEqual(['livechange', 'livechange', 'streamended']);
  });

  it('goToLive() delegates to the active player, no-ops with no active player', () => {
    const player = fakePlayer();
    mockFactoryReturning(player);
    const core = new UltraMediaCore(video());

    expect(() => core.goToLive()).not.toThrow();

    core.load('live.m3u8');
    core.goToLive();
    expect(player.goToLive).toHaveBeenCalledTimes(1);
  });

  it('live resets to neutral on teardown (format change) and on destroy()', () => {
    const el = video();
    const first = fakePlayer();
    const second = fakePlayer();
    mockFactoryReturning(first, second);
    const core = new UltraMediaCore(el);

    core.load('live.m3u8');
    withSeekable(el, 0, 20);
    first.emitLive(true, null);
    expect(core.live.isLive).toBe(true);

    core.load('vod.mp4'); // format change -> teardownPlayer()
    expect(core.live.isLive).toBe(false);

    second.emitLive(true, null);
    core.destroy();
    expect(core.live.isLive).toBe(false);
  });

  it('a livechange/streamended from a superseded generation is dropped (guarded like every other engine event)', () => {
    const el = video();
    const stale = fakePlayer();
    const current = fakePlayer();
    mockFactoryReturning(stale, current);
    const core = new UltraMediaCore(el);
    const handler = jest.fn();
    core.addEventListener('livechange', handler);
    core.addEventListener('streamended', handler);

    core.load('a.m3u8');
    core.load('b.mp3'); // format change (hls -> mp3) tears down `stale` and supersedes its generation
    handler.mockClear();

    stale.emitLive(true, null);
    stale.emitStreamEnded();

    expect(handler).not.toHaveBeenCalled();
  });
});
