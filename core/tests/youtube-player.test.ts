import { describe, it, expect, jest } from '@jest/globals';
import { YouTubePlayer } from '../src/players/youtube-player';

// Mock the global YT object. `Player` must be present here so that the
// module-level `loadYouTubeAPI()` cache resolves synchronously on the very
// first YouTubePlayer instantiation instead of waiting on a <script> tag
// that jsdom never actually loads (which would hang every test in this file,
// since the resolved/pending promise is cached across tests).
global.YT = {
  PlayerState: {
    PLAYING: 1,
    PAUSED: 2,
    ENDED: 0,
  },
  Player: jest.fn(),
};

function createVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

describe('YouTubePlayer', () => {
  it('should create an instance', () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);
    expect(player).toBeInstanceOf(YouTubePlayer);
  });

  it('should call load and create an iframe in the container', async () => {
    const element = createVideoElement();
    // ADR-0001: this file is imported by UltraMediaCore, which must not
    // depend on Shadow DOM - the iframe is a plain light-DOM child of
    // whatever `container` is given (real <ultra-media> usage passes
    // itself; its shadow template's unnamed <slot> re-projects it).
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    // Mock the YT.Player constructor
    const mockPlayerInstance = {
      playVideo: jest.fn(),
      pauseVideo: jest.fn(),
      destroy: jest.fn(),
    };
    window.YT.Player = jest.fn().mockImplementation(() => mockPlayerInstance);

    // Video ID must be exactly 11 chars to match the player's URL regex.
    player.load('https://www.youtube.com/watch?v=VIDEO_ID123');
    await player.onReady;

    expect(container.querySelector('iframe')).not.toBeNull();
    expect(element.querySelector('iframe')).toBeNull();
    expect(window.YT.Player).toHaveBeenCalled();
  });

  it('should dispatch play and pause events on the element', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    let onStateChangeCallback: (event: { data: number }) => void = () => {};

    const mockPlayerInstance = {
      playVideo: jest.fn(),
      pauseVideo: jest.fn(),
      destroy: jest.fn(),
      // onPlayerStateChange reads currentTime (via getCurrentTime) to detect seeks.
      getCurrentTime: jest.fn(() => 0),
    };
    window.YT.Player = jest.fn().mockImplementation((iframe, options) => {
      onStateChangeCallback = options.events.onStateChange;
      return mockPlayerInstance;
    });

    // Video ID must be exactly 11 chars to match the player's URL regex.
    player.load('https://www.youtube.com/watch?v=VIDEO_ID123');
    await player.onReady;

    // Events are dispatched on the native element (not the container) so that
    // media-chrome and other HTMLMediaElement consumers see them. See the
    // proxy pattern introduced for media-chrome compatibility.
    const playSpy = jest.spyOn(element, 'dispatchEvent');
    onStateChangeCallback({ data: global.YT.PlayerState.PLAYING });
    expect(playSpy).toHaveBeenCalledWith(new Event('play'));

    const pauseSpy = jest.spyOn(element, 'dispatchEvent');
    onStateChangeCallback({ data: global.YT.PlayerState.PAUSED });
    expect(pauseSpy).toHaveBeenCalledWith(new Event('pause'));
  });
});

// The module-level `loadYouTubeAPI()` cache (see youtube-player.ts) is what
// makes every other test in this file resolve `onReady` synchronously -
// `window.YT.Player` is already present at player-construction time. Testing
// the actual race (load()s that land *before* the IFrame API script finishes
// loading) needs a fresh copy of the module with no cached `apiLoaded` and no
// `window.YT` yet, so each test here gets its own via `jest.isolateModulesAsync`
// + a fresh `require()` - same technique hls-player.test.ts/dash-player.test.ts
// already use for their own SDK-load-race tests.
describe('YouTubePlayer cancels stale sources while the IFrame API is still loading (cycle 3, defect 1)', () => {
  const originalYT = (window as any).YT;

  afterEach(() => {
    (window as any).YT = originalYT;
    delete (window as any).onYouTubeIframeAPIReady;
  });

  async function withFreshYouTubePlayer(
    run: (ctx: { YouTubePlayer: typeof YouTubePlayer }) => Promise<void>
  ): Promise<void> {
    delete (window as any).YT;
    await jest.isolateModulesAsync(async () => {
      const freshModule = require('../src/players/youtube-player');
      await run({ YouTubePlayer: freshModule.YouTubePlayer });
    });
  }

  // Simulates the IFrame API script finally loading: defines `window.YT`
  // with a fake `Player` that records every videoId it's constructed with,
  // then invokes the ready callback `loadYouTubeAPI()` registered on
  // `window` before the (fake) script was inserted.
  function resolveApiReady(): string[] {
    const created: string[] = [];
    (window as any).YT = {
      PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
      Player: jest.fn().mockImplementation((_el: any, options: any) => {
        created.push(options.videoId);
        return { playVideo: jest.fn(), pauseVideo: jest.fn(), destroy: jest.fn() };
      }),
    };
    (window as any).onYouTubeIframeAPIReady();
    return created;
  }

  it('a rapid src swap (A -> B -> C) before the API is ready only creates a player for C', async () => {
    await withFreshYouTubePlayer(async ({ YouTubePlayer: FreshYouTubePlayer }) => {
      const element = createVideoElement();
      const container = document.createElement('div');
      const player = new FreshYouTubePlayer(element, container);

      player.load('https://www.youtube.com/watch?v=AAAAAAAAAAA');
      player.load('https://www.youtube.com/watch?v=BBBBBBBBBBB');
      player.load('https://www.youtube.com/watch?v=CCCCCCCCCCC');

      const created = resolveApiReady();
      await player.onReady;

      expect(created).toEqual(['CCCCCCCCCCC']);
    });
  });

  it('returning to an earlier src (A -> B -> A) before the API is ready creates a single player', async () => {
    await withFreshYouTubePlayer(async ({ YouTubePlayer: FreshYouTubePlayer }) => {
      const element = createVideoElement();
      const container = document.createElement('div');
      const player = new FreshYouTubePlayer(element, container);

      player.load('https://www.youtube.com/watch?v=AAAAAAAAAAA');
      player.load('https://www.youtube.com/watch?v=BBBBBBBBBBB');
      player.load('https://www.youtube.com/watch?v=AAAAAAAAAAA');

      const created = resolveApiReady();
      await player.onReady;

      expect(created).toEqual(['AAAAAAAAAAA']);
    });
  });

  it('destroy() before the API is ready creates no player', async () => {
    await withFreshYouTubePlayer(async ({ YouTubePlayer: FreshYouTubePlayer }) => {
      const element = createVideoElement();
      const container = document.createElement('div');
      const player = new FreshYouTubePlayer(element, container);

      player.load('https://www.youtube.com/watch?v=AAAAAAAAAAA');
      player.destroy();

      const created = resolveApiReady();
      await player.onReady;

      expect(created).toEqual([]);
      expect(container.querySelector('iframe')).toBeNull();
    });
  });
});
