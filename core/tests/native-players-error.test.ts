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

  it('a throwing transformUrl reports REQUEST_POLICY_ERROR and falls back to the original src', () => {
    const player = create() as any;
    const onError = jest.fn<(e: MediaPlayerError) => void>();
    player.onError(onError);

    player.load('https://example.com/a.mp4', { transformUrl: () => { throw new Error('boom'); } });

    expect(player.element.getAttribute('src')).toBe('https://example.com/a.mp4');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ fatal: false, code: 'REQUEST_POLICY_ERROR' }));
  });

  it('no request policy leaves the src untouched (no crash)', () => {
    const player = create() as any;
    expect(() => player.load('https://example.com/a.mp4')).not.toThrow();
    expect(player.element.getAttribute('src')).toBe('https://example.com/a.mp4');
  });
});
