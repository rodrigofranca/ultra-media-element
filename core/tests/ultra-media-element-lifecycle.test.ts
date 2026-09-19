import { describe, it, expect, jest } from '@jest/globals';
import { UltraMediaElement } from '../src/ultra-media-element';
import { PlayerFactory } from '../src/core/player-factory';

// super-media-element and media-tracks ship ESM-only (no CJS build) and
// aren't part of Jest's transform pipeline (see jest.config.cjs) - real
// browser/e2e coverage for their behavior lives in core/e2e/tests/*.spec.ts.
// This unit test only exercises UltraMediaElement's own destroy()/
// connectedCallback/disconnectedCallback logic, so a minimal stand-in for
// each base class is enough: just the pieces ultra-media-element.ts's
// constructor and lifecycle callbacks touch.
// `src` is a real property on the native SuperVideoElement (backed by the
// `src` attribute) and it's what actually adds 'src' to the merged
// static `observedAttributes` UltraMediaElement.observedAttributes reads
// (see super-media-element.js) - both are needed here so tests further
// down can exercise the real attribute-driven init/reload path instead of
// only UltraMediaElement's own destroy()/connect debounce logic.
jest.mock('super-media-element', () => ({
  SuperVideoElement: class extends HTMLElement {
    static observedAttributes = ['src'];
    private __nativeEl?: HTMLVideoElement;
    get nativeEl() {
      if (!this.__nativeEl) this.__nativeEl = document.createElement('video');
      return this.__nativeEl;
    }
    get src() { return this.getAttribute('src'); }
    set src(val: string) { this.setAttribute('src', String(val)); }
  },
  Events: ['loadedmetadata', 'play', 'pause', 'error'],
}));

jest.mock('media-tracks', () => ({
  MediaTracksMixin: (Base: typeof HTMLElement) =>
    class extends Base {
      audioTracks = { onchange: null as (() => void) | null, [Symbol.iterator]: function* () {} };
      videoRenditions = { onchange: null as (() => void) | null, [Symbol.iterator]: function* () {} };
      videoTracks: unknown[] = [];
      addAudioTrack() { return {}; }
      addVideoTrack() { return {}; }
      removeAudioTrack() {}
      removeVideoTrack() {}
    },
}));

// player-factory.ts itself hits the network (loadSDK); these tests only
// care about *when* UltraMediaElement asks it for a player, so it's
// replaced with a tracking stub - `getCurrentFormatFromElement` stays real
// since attributeChangedCallback's format-diffing depends on it.
jest.mock('../src/core/player-factory', () => {
  const actual = jest.requireActual('../src/core/player-factory') as any;
  return { ...actual, PlayerFactory: { create: jest.fn() } };
});

if (!customElements.get('ultra-media')) {
  customElements.define('ultra-media', UltraMediaElement);
}

function createElement(): UltraMediaElement {
  return document.createElement('ultra-media') as unknown as UltraMediaElement;
}

function fakePlayer() {
  return { destroy: jest.fn(), onReady: Promise.resolve(), load: jest.fn() };
}

type CreatedPlayer = { src: string; player: ReturnType<typeof fakePlayer> };

/**
 * Stubs PlayerFactory.create() to record every player it's asked to build,
 * without touching the network - lets these tests assert *how many* players
 * got created/destroyed and with which src, the way the real factory would
 * report format via `element.dataset.type`.
 */
function trackingPlayerFactory(): CreatedPlayer[] {
  const created: CreatedPlayer[] = [];
  (PlayerFactory.create as jest.Mock).mockImplementation((({ src, element }: { src: string; element: HTMLVideoElement }) => {
    element.dataset.type = src.includes('.m3u8') ? 'hls.js' : src.includes('.mpd') ? 'dash.js' : 'video/mp4';
    const player = fakePlayer();
    created.push({ src, player });
    return player;
  }) as any);
  return created;
}

describe('UltraMediaElement#destroy', () => {
  it('is a no-op when no player exists yet', () => {
    const el = createElement();
    expect(() => el.destroy()).not.toThrow();
  });

  it('destroys the active player and clears it', () => {
    const el = createElement();
    const player = fakePlayer();
    (el as any).player = player;

    el.destroy();

    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect((el as any).player).toBeNull();
  });

  it('is idempotent - calling it again does not re-invoke the old player', () => {
    const el = createElement();
    const player = fakePlayer();
    (el as any).player = player;

    el.destroy();
    el.destroy();
    el.destroy();

    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect((el as any).player).toBeNull();
  });
});

describe('UltraMediaElement disconnect/reconnect debounce', () => {
  it('tears the player down after an effective disconnect (element left removed)', async () => {
    const el = createElement();
    document.body.appendChild(el);
    const player = fakePlayer();
    (el as any).player = player;

    el.remove();
    expect(player.destroy).not.toHaveBeenCalled();

    // Let the disconnectedCallback's queueMicrotask run.
    await Promise.resolve();
    await Promise.resolve();

    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect((el as any).player).toBeNull();
  });

  it('does not tear the player down when moved synchronously (disconnect immediately followed by reconnect)', async () => {
    const el = createElement();
    document.body.appendChild(el);
    const player = fakePlayer();
    (el as any).player = player;

    // Simulates a framework re-parenting the element: disconnect then
    // reconnect within the same synchronous tick, before the teardown
    // microtask has a chance to run.
    el.remove();
    document.body.appendChild(el);

    await Promise.resolve();
    await Promise.resolve();

    expect(player.destroy).not.toHaveBeenCalled();
    expect((el as any).player).toBe(player);

    el.remove();
  });
});

describe('UltraMediaElement src while disconnected (defect 4)', () => {
  afterEach(() => {
    (PlayerFactory.create as jest.Mock).mockReset();
  });

  // Remove the element, let the teardown microtask actually run (an
  // *effective* disconnect), then change `src` while still disconnected,
  // then reconnect. attributeChangedCallback used to initialize a player
  // even while disconnected, and connectedCallback initialized a second one
  // via `pendingReload` on top of it - the first was never destroyed.
  it('changing src while disconnected after an effective teardown creates exactly one player, no orphans', async () => {
    const created = trackingPlayerFactory();
    const el = createElement();
    document.body.appendChild(el);

    el.src = 'https://example.com/a.m3u8';
    expect(created).toHaveLength(1);

    el.remove();
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0].player.destroy).toHaveBeenCalledTimes(1);

    // Still disconnected - must not create a player yet.
    el.src = 'https://example.com/b.m3u8';
    expect(created).toHaveLength(1);

    document.body.appendChild(el);

    expect(created).toHaveLength(2);
    expect(created[1].src).toBe('https://example.com/b.m3u8');
    // The first instance is destroyed exactly once - never re-entered.
    expect(created[0].player.destroy).toHaveBeenCalledTimes(1);

    el.remove();
  });

  // Must keep working: an element created via JS, with `src` assigned
  // before it's ever inserted into the DOM.
  it('created via JS with src assigned before insertion still initializes exactly one player on connect', () => {
    const created = trackingPlayerFactory();
    const el = createElement();

    el.src = 'https://example.com/a.m3u8';
    expect(created).toHaveLength(0);

    document.body.appendChild(el);

    expect(created).toHaveLength(1);
    expect(created[0].src).toBe('https://example.com/a.m3u8');

    el.remove();
  });
});

describe('UltraMediaElement reload after destroy() with the same src (defect 5)', () => {
  afterEach(() => {
    (PlayerFactory.create as jest.Mock).mockReset();
  });

  it('reassigning the same src after destroy() re-initializes the player', () => {
    const created = trackingPlayerFactory();
    const el = createElement();
    document.body.appendChild(el);

    el.src = 'https://example.com/a.m3u8';
    expect(created).toHaveLength(1);

    el.destroy();
    expect(created[0].player.destroy).toHaveBeenCalledTimes(1);

    // eslint-disable-next-line no-self-assign
    el.src = el.src;

    expect(created).toHaveLength(2);
    expect(created[1].src).toBe('https://example.com/a.m3u8');

    el.remove();
  });

  // A genuinely no-op reassignment (same value, player still active) must
  // NOT re-trigger initialization - only the destroy()'d case above should.
  it('reassigning the same src while a player is still active is a no-op', () => {
    const created = trackingPlayerFactory();
    const el = createElement();
    document.body.appendChild(el);

    el.src = 'https://example.com/a.m3u8';
    expect(created).toHaveLength(1);

    // eslint-disable-next-line no-self-assign
    el.src = el.src;

    expect(created).toHaveLength(1);
    expect(created[0].player.destroy).not.toHaveBeenCalled();

    el.remove();
  });
});
