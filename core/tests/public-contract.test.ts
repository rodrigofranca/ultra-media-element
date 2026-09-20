import { describe, it, expect, jest } from '@jest/globals';
import { UltraMediaElement } from '../src/ultra-media-element';
import { PlayerFactory } from '../src/core/player-factory';
import type { MediaPlayerError } from '../src/core/media-player';

// Freezes the *own* part of <ultra-media>'s effective public API (ADR-0001,
// Fase 1) - the rules UltraMediaElement itself applies on top of whatever it
// inherits. The real inherited surface (custom-media-element's native
// passthrough, media-tracks) is frozen against the actual built bundle in a
// real browser instead - see e2e/tests/public-contract.spec.ts and
// docs/public-api.md for why jsdom isn't enough for that part.
//
// Same minimal stand-ins as ultra-media-element-lifecycle.test.ts, and for
// the same reason: custom-media-element/media-tracks ship ESM-only and
// aren't part of Jest's transform pipeline.
jest.mock('custom-media-element', () => ({
  CustomVideoElement: class extends HTMLElement {
    static observedAttributes = ['src'];
    private __nativeEl?: HTMLVideoElement;
    get nativeEl() {
      if (!this.__nativeEl) this.__nativeEl = document.createElement('video');
      return this.__nativeEl;
    }
    get src() { return this.getAttribute('src'); }
    set src(val: string) { this.setAttribute('src', String(val)); }
  },
  // Deliberately includes 'error' and a couple of arbitrary names, distinct
  // from the real 28-entry list - this test only needs to prove
  // UltraMediaElement.Events == "whatever the base exposes, minus 'error'",
  // not what the real base exposes (that's e2e's job).
  Events: ['loadedmetadata', 'play', 'pause', 'error'],
}));

jest.mock('media-tracks', () => ({
  MediaTracksMixin: (Base: typeof HTMLElement) =>
    class extends Base {
      audioTracks = { onchange: null as (() => void) | null, [Symbol.iterator]: function* () {} };
      videoRenditions = { onchange: null as (() => void) | null, [Symbol.iterator]: function* () {} };
      videoTracks: unknown[] = [];
      addAudioTrack = jest.fn((kind: string, label?: string, language?: string) => ({ kind, label, language, id: '' }));
      addVideoTrack = jest.fn((kind: string) => ({ kind, id: '', addRendition: jest.fn(() => ({ id: '' })) }));
      removeAudioTrack() {}
      removeVideoTrack() {}
    },
}));

jest.mock('../src/core/player-factory', () => {
  const actual = jest.requireActual('../src/core/player-factory') as any;
  // resolveEngine() stays real - UltraMediaCore.load() calls it directly
  // (cycle 3, defect 1) instead of reading the engine back off the
  // <video>'s data-type, which real PlayerFactory.create() no longer writes.
  return { ...actual, PlayerFactory: { create: jest.fn(), resolveEngine: actual.PlayerFactory.resolveEngine } };
});

if (!customElements.get('ultra-media')) {
  customElements.define('ultra-media', UltraMediaElement);
}

function createElement(): UltraMediaElement {
  return document.createElement('ultra-media') as unknown as UltraMediaElement;
}

function fakePlayer(overrides: Partial<Record<string, unknown>> = {}) {
  return { destroy: jest.fn(), onReady: Promise.resolve(), load: jest.fn(), ...overrides };
}

describe('static members', () => {
  it('skipAttributes is exactly ["src"]', () => {
    expect(UltraMediaElement.skipAttributes).toEqual(['src']);
  });

  it('Events is the inherited list with "error" filtered out, order preserved', () => {
    expect(UltraMediaElement.Events).toEqual(['loadedmetadata', 'play', 'pause']);
  });

  it('observedAttributes extends the inherited list with "live"', () => {
    expect(UltraMediaElement.observedAttributes).toEqual(['src', 'live']);
  });
});

describe('own methods exist with the right shape', () => {
  it('destroy/changeSource/getCurrentFormat are functions on the prototype', () => {
    const el = createElement();
    expect(typeof el.destroy).toBe('function');
    expect(typeof el.changeSource).toBe('function');
    expect(typeof el.getCurrentFormat).toBe('function');
  });

  it('changeSource sets the src attribute', async () => {
    const el = createElement();
    await el.changeSource('https://example.com/a.mp4');
    expect(el.getAttribute('src')).toBe('https://example.com/a.mp4');
  });

  it('changeSource warns and does nothing for a falsy source', async () => {
    const el = createElement();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await el.changeSource('');
    expect(el.hasAttribute('src')).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // cycle 2, defect 4: getCurrentFormat() used to read nativeEl.dataset.type
  // directly (via getCurrentFormatFromElement) - a residue PlayerFactory
  // used to write but destroy() never cleared, so it kept reporting the old
  // format forever. The core's own `format` (reset to null by destroy()) is
  // the real source of truth; PlayerFactory.create() doesn't write
  // data-type on the element at all any more (cycle 3, defect 1).
  it('getCurrentFormat reflects the core\'s active format, and destroy() resets it to undefined', () => {
    (PlayerFactory.create as jest.Mock).mockImplementation((() => {
      return { destroy: jest.fn(), onReady: Promise.resolve(), load: jest.fn() };
    }) as any);

    const el = createElement();
    document.body.appendChild(el);
    el.src = 'https://example.com/a.m3u8';

    expect(el.getCurrentFormat()).toBe('hls');

    el.destroy();
    expect(el.getCurrentFormat()).toBeUndefined();

    el.remove();
    (PlayerFactory.create as jest.Mock).mockReset();
  });
});

// ADR-0001 D4 - no HTML attribute (headers with tokens don't belong in
// markup): the only surface is this get/set property, forwarded to the core.
describe('request property (ADR-0001 D4)', () => {
  afterEach(() => {
    (PlayerFactory.create as jest.Mock).mockReset();
  });

  it('defaults to undefined and round-trips through the getter', () => {
    const el = createElement();
    expect(el.request).toBeUndefined();

    const policy = { headers: { Authorization: 'Bearer t' } };
    el.request = policy;
    expect(el.request).toBe(policy);
  });

  it('set before any src is assigned is picked up when the core is first created', () => {
    let captured: unknown;
    (PlayerFactory.create as jest.Mock).mockImplementation(((props: any) => {
      captured = props.requestPolicy;
      return fakePlayer();
    }) as any);

    const el = createElement();
    const policy = { headers: { Authorization: 'Bearer t' } };
    el.request = policy;
    document.body.appendChild(el);
    el.src = 'https://example.com/a.mp4';

    expect(captured).toBe(policy);
    el.remove();
  });

  it('set after the core exists calls core.configure() (next load(), not the active one)', () => {
    (PlayerFactory.create as jest.Mock).mockImplementation((() => fakePlayer()) as any);

    const el = createElement();
    document.body.appendChild(el);
    el.src = 'https://example.com/a.mp4';

    const configureSpy = jest.spyOn((el as any).core, 'configure');
    const policy = { credentials: 'include' as const };
    el.request = policy;

    expect(configureSpy).toHaveBeenCalledWith({ request: policy });
    el.remove();
  });
});

// ADR-0001 D5. Before this step the `live` attribute existed in
// observedAttributes with no effect at all (see docs/adr/0001's D5 section);
// now it seeds options.live, and isLive/liveInfo/goToLive mirror core.live.
describe('live (ADR-0001 D5)', () => {
  afterEach(() => {
    (PlayerFactory.create as jest.Mock).mockReset();
  });

  it('defaults to false/undefined with no core, and with no load()', () => {
    const el = createElement();
    expect(el.isLive).toBe(false);
    expect(el.liveInfo).toBeUndefined();
    expect(el.streamType).toBe('on-demand');
    expect(Number.isNaN(el.targetLiveWindow)).toBe(true);

    el.setAttribute('live', '');
    expect(el.isLive).toBe(false);
  });

  it('the "live" attribute present at core creation is options.live: true; absent is \'auto\'', () => {
    let captured: unknown;
    (PlayerFactory.create as jest.Mock).mockImplementation(((props: any) => {
      captured = props.live;
      return fakePlayer();
    }) as any);

    const el = createElement();
    el.setAttribute('live', '');
    document.body.appendChild(el);
    el.src = 'https://example.com/live.m3u8';

    expect(captured).toBe(true);
    el.remove();
  });

  it('a later "live" attribute change calls core.configure({ live }), not a reload', () => {
    (PlayerFactory.create as jest.Mock).mockImplementation((() => fakePlayer()) as any);

    const el = createElement();
    document.body.appendChild(el);
    el.src = 'https://example.com/a.mp4';

    const configureSpy = jest.spyOn((el as any).core, 'configure');
    el.setAttribute('live', '');
    expect(configureSpy).toHaveBeenCalledWith({ live: true });

    el.removeAttribute('live');
    expect(configureSpy).toHaveBeenCalledWith({ live: 'auto' });
    el.remove();
  });

  it('isLive/liveInfo/streamType/targetLiveWindow mirror the core once the engine reports live, and goToLive() delegates', () => {
    let liveCb: ((isLive: boolean, playheadDate: Date | null) => void) | undefined;
    const goToLive = jest.fn();
    (PlayerFactory.create as jest.Mock).mockImplementation((() => fakePlayer({
      onLiveChange: (cb: (isLive: boolean, playheadDate: Date | null) => void) => { liveCb = cb; },
      goToLive,
    })) as any);

    const el = createElement();
    document.body.appendChild(el);
    el.src = 'https://example.com/live.m3u8';

    Object.defineProperty((el as any).nativeEl, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 20 },
    });

    liveCb?.(true, new Date('2026-01-01T00:00:00Z'));

    expect(el.isLive).toBe(true);
    expect(el.liveInfo?.isLive).toBe(true);
    expect(el.streamType).toBe('live');
    expect(el.targetLiveWindow).toBe(0); // 20s window, under the 30s DVR threshold

    el.goToLive();
    expect(goToLive).toHaveBeenCalledTimes(1);

    el.remove();
  });

  it('livechange/streamended re-dispatch as CustomEvents, and drive streamtypechange/targetlivewindowchange', () => {
    let liveCb: ((isLive: boolean, playheadDate: Date | null) => void) | undefined;
    let endedCb: (() => void) | undefined;
    (PlayerFactory.create as jest.Mock).mockImplementation((() => fakePlayer({
      onLiveChange: (cb: (isLive: boolean, playheadDate: Date | null) => void) => { liveCb = cb; },
      onStreamEnded: (cb: () => void) => { endedCb = cb; },
    })) as any);

    const el = createElement();
    document.body.appendChild(el);
    el.src = 'https://example.com/live.m3u8';
    Object.defineProperty((el as any).nativeEl, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 20 },
    });

    const livechange = jest.fn();
    const streamended = jest.fn();
    const streamtypechange = jest.fn();
    const targetlivewindowchange = jest.fn();
    el.addEventListener('livechange', livechange);
    el.addEventListener('streamended', streamended);
    el.addEventListener('streamtypechange', streamtypechange);
    el.addEventListener('targetlivewindowchange', targetlivewindowchange);

    liveCb?.(true, null);
    expect(livechange).toHaveBeenCalledTimes(1);
    expect((livechange.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ isLive: true });
    expect(streamtypechange).toHaveBeenCalledTimes(1);
    expect(targetlivewindowchange).toHaveBeenCalledTimes(1);

    endedCb?.();
    expect(streamended).toHaveBeenCalledTimes(1);
    // streamended's own livechange (core.wireUp) fires the two synthetic events again.
    expect(streamtypechange).toHaveBeenCalledTimes(2);

    el.remove();
  });
});

describe('error/warning routing policy (fatal -> error, else -> warning)', () => {
  afterEach(() => {
    (PlayerFactory.create as jest.Mock).mockReset();
  });

  function captureErrorCallback(): { el: UltraMediaElement; emit: (e: MediaPlayerError) => void } {
    let captured: ((e: MediaPlayerError) => void) | undefined;
    (PlayerFactory.create as jest.Mock).mockImplementation((() => {
      const player = fakePlayer({
        onError: (cb: (e: MediaPlayerError) => void) => { captured = cb; },
      });
      return player;
    }) as any);

    const el = createElement();
    document.body.appendChild(el);
    el.src = 'https://example.com/a.mp4';

    return { el, emit: (e) => captured?.(e) };
  }

  it('dispatches "error" when fatal is true, with the same detail', () => {
    const { el, emit } = captureErrorCallback();
    const handler = jest.fn();
    el.addEventListener('error', handler);

    const err: MediaPlayerError = { fatal: true, category: 'networkError', code: 'X', message: 'm', engine: 'video/mp4' };
    emit(err);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual(err);
    el.remove();
  });

  it('dispatches "warning" (not "error") when fatal is false', () => {
    const { el, emit } = captureErrorCallback();
    const errorHandler = jest.fn();
    const warningHandler = jest.fn();
    el.addEventListener('error', errorHandler);
    el.addEventListener('warning', warningHandler);

    const err: MediaPlayerError = { fatal: false, category: 'networkError', code: 'X', message: 'm', engine: 'video/mp4' };
    emit(err);

    expect(errorHandler).not.toHaveBeenCalled();
    expect(warningHandler).toHaveBeenCalledTimes(1);
    expect((warningHandler.mock.calls[0][0] as CustomEvent).detail).toEqual(err);
    el.remove();
  });
});

describe('track sync (onTracksChange -> media-tracks lists)', () => {
  afterEach(() => {
    (PlayerFactory.create as jest.Mock).mockReset();
  });

  it('adds an audio track and a "main" video track with renditions from the reported MediaTracks', () => {
    let reportTracks: ((t: unknown) => void) | undefined;
    (PlayerFactory.create as jest.Mock).mockImplementation((() => fakePlayer({
      onTracksChange: (cb: (t: unknown) => void) => { reportTracks = cb; },
    })) as any);

    const el = createElement();
    document.body.appendChild(el);
    el.src = 'https://example.com/a.m3u8';

    reportTracks?.({
      audio: [{ id: '0', kind: 'main', label: 'English', language: 'en', default: true }],
      renditions: [{ id: '0', width: 1280, height: 720, bitrate: 1000, frameRate: 30, codec: 'avc1' }],
    });

    expect((el as any).addAudioTrack).toHaveBeenCalledWith('main', 'English', 'en');
    expect((el as any).addVideoTrack).toHaveBeenCalledWith('main');
    el.remove();
  });
});
