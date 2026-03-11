import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { YouTubePlayer } from '../src/players/youtube-player';

// Mock the global YT object and YouTube API loading
const mockPlayerInstance = {
  playVideo: jest.fn(),
  pauseVideo: jest.fn(),
  destroy: jest.fn(),
  isMuted: jest.fn(() => false),
  mute: jest.fn(),
  unMute: jest.fn(),
  getVolume: jest.fn(() => 100),
  setVolume: jest.fn(),
  getCurrentTime: jest.fn(() => 0),
  seekTo: jest.fn(),
  getDuration: jest.fn(() => 100),
};

const mockYT = {
  PlayerState: {
    PLAYING: 1,
    PAUSED: 2,
    ENDED: 0,
    BUFFERING: 3,
  },
  Player: jest.fn().mockImplementation((iframe, options) => {
    // Simulate onReady callback immediately
    options.events.onReady();
    return mockPlayerInstance;
  }),
};

Object.defineProperty(window, 'YT', {
  writable: true,
  value: mockYT,
});

// Mock document.head and script tag creation for network.ts
const mockHead = {
  appendChild: jest.fn(),
};
Object.defineProperty(document, 'head', {
  writable: true,
  value: mockHead,
});

const mockFirstScriptTag = {
  parentNode: {
    insertBefore: jest.fn(),
  },
};
Object.defineProperty(document, 'getElementsByTagName', {
  writable: true,
  value: jest.fn(() => [mockFirstScriptTag]),
});

function createVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

describe('YouTubePlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the apiLoaded promise in YouTubePlayer module
    jest.resetModules();
    // Re-import YouTubePlayer to get a fresh module state
    const { YouTubePlayer: NewYouTubePlayer } = require('../src/players/youtube-player');
    Object.assign(YouTubePlayer, NewYouTubePlayer);
  });

  it('should create an instance', () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);
    expect(player).toBeInstanceOf(YouTubePlayer);
  });

  it('should call load and create an iframe in the container', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    expect(container.querySelector('iframe')).not.toBeNull();
    expect(mockYT.Player).toHaveBeenCalled();
  }, 10000); // Increase timeout for this test

  it('should dispatch play and pause events on the container', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    let onStateChangeCallback: (event: { data: number }) => void = () => {};

    mockYT.Player.mockImplementation((iframe, options) => {
      onStateChangeCallback = options.events.onStateChange;
      options.events.onReady(); // Simulate onReady
      return mockPlayerInstance;
    });

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    const playSpy = jest.spyOn(container, 'dispatchEvent');
    onStateChangeCallback({ data: mockYT.PlayerState.PLAYING });
    expect(playSpy).toHaveBeenCalledWith(new Event('play'));

    const pauseSpy = jest.spyOn(container, 'dispatchEvent');
    onStateChangeCallback({ data: mockYT.PlayerState.PAUSED });
    expect(pauseSpy).toHaveBeenCalledWith(new Event('pause'));
  }, 10000); // Increase timeout for this test

  it('should handle muted property', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    player.muted = true;
    expect(mockPlayerInstance.mute).toHaveBeenCalled();
    player.muted = false;
    expect(mockPlayerInstance.unMute).toHaveBeenCalled();
    expect(player.muted).toBe(false); // Should reflect the mock's return
  });

  it('should handle volume property', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    player.volume = 0.5;
    expect(mockPlayerInstance.setVolume).toHaveBeenCalledWith(50);
    expect(player.volume).toBe(1); // Should reflect the mock's return
  });

  it('should handle currentTime property', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    player.currentTime = 10;
    expect(mockPlayerInstance.seekTo).toHaveBeenCalledWith(10, true);
    expect(player.currentTime).toBe(0); // Should reflect the mock's return
  });

  it('should handle duration property', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    expect(player.duration).toBe(100); // Should reflect the mock's return
  });

  it('should destroy the player and remove iframe', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();

    player.destroy();
    expect(mockPlayerInstance.destroy).toHaveBeenCalled();
    expect(container.querySelector('iframe')).toBeNull();
    expect(element.style.display).toBe('');
  });
});

