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
    // The player appends the iframe to the container's shadow root (real
    // usage passes the <ultra-media> custom element, which always has one).
    const container = document.createElement('div');
    container.attachShadow({ mode: 'open' });
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

    expect(container.shadowRoot?.querySelector('iframe')).not.toBeNull();
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
