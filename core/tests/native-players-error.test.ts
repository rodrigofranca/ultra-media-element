import { describe, it, expect, jest } from '@jest/globals';
import { VideoPlayer } from '../src/players/video-player';
import { AudioPlayer } from '../src/players/audio-player';
import type { MediaPlayerError } from '../src/core/media-player';

// UltraMediaCore reuses the same native player across same-format loads and
// calls onError() again for every load() (one callback per load generation).
const cases = [
  ['VideoPlayer', () => new VideoPlayer(document.createElement('video'))],
  ['AudioPlayer', () => new AudioPlayer(document.createElement('audio') as unknown as HTMLAudioElement)],
] as const;

function setMediaError(element: HTMLMediaElement, code: number | null) {
  Object.defineProperty(element, 'error', {
    configurable: true,
    get: () => (code === null ? null : { code, message: '' }),
  });
}

describe.each(cases)('%s error wiring', (_name, create) => {
  it('keeps a single listener however many times onError() is called', () => {
    const player = create() as any;
    const element: HTMLMediaElement = player.element;
    const add = jest.spyOn(element, 'addEventListener');
    const remove = jest.spyOn(element, 'removeEventListener');

    const first = jest.fn<(e: MediaPlayerError) => void>();
    const second = jest.fn<(e: MediaPlayerError) => void>();
    player.onError(first);
    player.onError(second);

    const added = add.mock.calls.filter(([type]) => type === 'error').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'error').length;
    expect(added - removed).toBe(1);

    setMediaError(element, 4);
    element.dispatchEvent(new Event('error'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale error event from a superseded source (element.error already reset by the new load)", () => {
    const player = create() as any;
    const element: HTMLMediaElement = player.element;
    const callback = jest.fn<(e: MediaPlayerError) => void>();
    player.onError(callback);

    // load(B) started: the media element load algorithm has reset `error`
    // to null; an `error` event queued for A is delivered after that.
    setMediaError(element, null);
    element.dispatchEvent(new Event('error'));

    expect(callback).not.toHaveBeenCalled();
  });
});

// ADR-0001 D4 - the browser fetches this URL itself: transformUrl/crossOrigin
// on it are the only things a native player can apply; `headers` gets a
// warning instead of being silently dropped.
describe.each(cases)('%s request policy (ADR-0001 D4)', (_name, create) => {
  it('applies transformUrl to the loaded src', () => {
    const player = create() as any;
    player.load('https://example.com/a.mp4', { transformUrl: (ctx: any) => ctx.url + '?sig=1' });

    expect(player.element.getAttribute('src')).toBe('https://example.com/a.mp4?sig=1');
  });

  it('maps credentials to crossOrigin', () => {
    const player = create() as any;
    player.load('https://example.com/a.mp4', { credentials: 'include' });
    expect(player.element.crossOrigin).toBe('use-credentials');

    player.load('https://example.com/b.mp4', { credentials: 'same-origin' });
    expect(player.element.crossOrigin).toBe('anonymous');
  });

  it('leaves crossOrigin untouched when credentials is not set', () => {
    const player = create() as any;
    const before = player.element.crossOrigin;
    player.load('https://example.com/a.mp4', {});
    expect(player.element.crossOrigin).toBe(before);
  });

  it('reports REQUEST_HEADERS_UNSUPPORTED once, deferred to a microtask (after PlayerFactory.create()\'s synchronous load() call)', async () => {
    const player = create() as any;
    const onError = jest.fn<(e: MediaPlayerError) => void>();
    player.onError(onError);

    player.load('https://example.com/a.mp4', { headers: { Authorization: 'Bearer t' } });
    expect(onError).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, code: 'REQUEST_HEADERS_UNSUPPORTED' }));
  });

  // result-cycle2.md defect 3(a) - UltraMediaCore calls player.load()
  // *before* wireUp() registers onError for this load's generation
  // (PlayerFactory.create()/UltraMediaCore.load()). A report that used to
  // fire synchronously, during load() itself, found no listener at all on
  // this player's very first load - deferring to a microtask (like
  // REQUEST_HEADERS_UNSUPPORTED already did) fixes that: by the time it
  // fires, wireUp() has already run, synchronously, in the same tick.
  it('a throwing transformUrl reports REQUEST_POLICY_ERROR (deferred to a microtask) and falls back to the original src', async () => {
    const player = create() as any;
    const onError = jest.fn<(e: MediaPlayerError) => void>();
    player.onError(onError);

    player.load('https://example.com/a.mp4', { transformUrl: () => { throw new Error('boom'); } });
    expect(player.element.getAttribute('src')).toBe('https://example.com/a.mp4');
    expect(onError).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, code: 'REQUEST_POLICY_ERROR' }));
  });

  // result-cycle2.md defect 3(b) - deferring alone isn't enough: UltraMediaCore
  // reuses this same player instance across same-format load()s, and each
  // load()'s wireUp() replaces onError() wholesale (see the "keeps a single
  // listener" test above). A load() immediately superseded by another one,
  // before its deferred report fires, must not surface *any* warning for
  // the load that no longer applies - not even through the new load's
  // (unrelated) callback.
  it('a load() immediately superseded by another one before its deferred warning fires reports nothing for the stale load', async () => {
    const player = create() as any;
    const onError = jest.fn<(e: MediaPlayerError) => void>();
    player.onError(onError); // mirrors wireUp() running right after PlayerFactory.create()

    player.load('https://example.com/a.mp4', { headers: { Authorization: 'Bearer t' } }); // load A - schedules a deferred warning
    player.load('https://example.com/b.mp4'); // load B, synchronously, before A's microtask fires - no policy, nothing new to warn about

    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  // result-cycle2.md defect 3(c) - destroy() before a deferred warning fires
  // must also drop it, the same way a superseding load() does.
  it('destroy() before a deferred warning fires reports nothing', async () => {
    const player = create() as any;
    const onError = jest.fn<(e: MediaPlayerError) => void>();
    player.onError(onError);

    player.load('https://example.com/a.mp4', { headers: { Authorization: 'Bearer t' } });
    player.destroy();

    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('no request policy leaves the src untouched (no crash)', () => {
    const player = create() as any;
    expect(() => player.load('https://example.com/a.mp4')).not.toThrow();
    expect(player.element.getAttribute('src')).toBe('https://example.com/a.mp4');
  });

  // result-cycle2.md defect 5 - crossOrigin can only tell 'include' apart
  // from everything else (no Web Platform "omit cookies even same-origin"
  // mode for <video src>/<audio src> - see README.md), so 'omit' and
  // 'same-origin' both map to 'anonymous', same as before this fix.
  it('maps credentials:"omit" to crossOrigin "anonymous"', () => {
    const player = create() as any;
    player.load('https://example.com/a.mp4', { credentials: 'omit' });
    expect(player.element.crossOrigin).toBe('anonymous');
  });
});

// result-cycle2.md defect 2 (Importante) - crossOrigin is a real attribute
// on the host's <video>/<audio>; apply-request-policy.ts's applyNativeLoad
// wrote it but nothing undid it in destroy(), so the host's element came
// back from a `credentials`-configured load permanently changed.
describe.each(cases)('%s crossOrigin restore on destroy() (ADR-0001 D4)', (_name, create) => {
  it('destroy() removes crossOrigin entirely when the attribute was absent before load()', () => {
    const player = create() as any;
    expect(player.element.hasAttribute('crossorigin')).toBe(false);

    player.load('https://example.com/a.mp4', { credentials: 'include' });
    expect(player.element.getAttribute('crossorigin')).toBe('use-credentials');

    player.destroy();

    expect(player.element.hasAttribute('crossorigin')).toBe(false);
  });

  it('destroy() restores the exact crossOrigin value the host had set before load()', () => {
    const player = create() as any;
    player.element.setAttribute('crossorigin', 'anonymous');

    player.load('https://example.com/a.mp4', { credentials: 'include' });
    expect(player.element.getAttribute('crossorigin')).toBe('use-credentials');

    player.destroy();

    expect(player.element.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('a later load() on the same instance still restores the value from before the very first write, not an intermediate one', () => {
    const player = create() as any;
    expect(player.element.hasAttribute('crossorigin')).toBe(false);

    player.load('https://example.com/a.mp4', { credentials: 'include' });
    player.load('https://example.com/b.mp4', { credentials: 'omit' });
    expect(player.element.getAttribute('crossorigin')).toBe('anonymous');

    player.destroy();

    expect(player.element.hasAttribute('crossorigin')).toBe(false);
  });

  it('leaves a host override made after our write alone (same criterion YouTubePlayer uses for style.display)', () => {
    const player = create() as any;
    player.load('https://example.com/a.mp4', { credentials: 'include' });

    player.element.setAttribute('crossorigin', 'anonymous'); // host changed it after our write

    player.destroy();

    expect(player.element.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('destroy() is a no-op on crossOrigin when no load() ever set credentials', () => {
    const player = create() as any;
    player.element.setAttribute('crossorigin', 'anonymous');

    player.load('https://example.com/a.mp4');
    player.destroy();

    expect(player.element.getAttribute('crossorigin')).toBe('anonymous');
  });
});
