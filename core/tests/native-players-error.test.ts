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
