import { describe, it, expect, jest } from '@jest/globals';
import { UltraMediaElement } from '../src/ultra-media-element';

// super-media-element and media-tracks ship ESM-only (no CJS build) and
// aren't part of Jest's transform pipeline (see jest.config.cjs) - real
// browser/e2e coverage for their behavior lives in core/e2e/tests/*.spec.ts.
// This unit test only exercises UltraMediaElement's own destroy()/
// connectedCallback/disconnectedCallback logic, so a minimal stand-in for
// each base class is enough: just the pieces ultra-media-element.ts's
// constructor and lifecycle callbacks touch.
jest.mock('super-media-element', () => ({
  SuperVideoElement: class extends HTMLElement {},
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

if (!customElements.get('ultra-media')) {
  customElements.define('ultra-media', UltraMediaElement);
}

function createElement(): UltraMediaElement {
  return document.createElement('ultra-media') as unknown as UltraMediaElement;
}

function fakePlayer() {
  return { destroy: jest.fn(), onReady: Promise.resolve(), load: jest.fn() };
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
