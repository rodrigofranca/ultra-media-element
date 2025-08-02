import { describe, it, expect, jest } from '@jest/globals';
import { YouTubePlayer } from '../src/players/youtube-player';

// Mock the global YT object
global.YT = {
  PlayerState: {
    PLAYING: 1,
    PAUSED: 2,
    ENDED: 0,
  },
};

function createVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

describe('YouTubePlayer', () => {
  it('should create an instance', () => {
    const element = createVideoElement();
    const player = new YouTubePlayer(element);
    expect(player).toBeInstanceOf(YouTubePlayer);
  });

  it('should call load and create an iframe in the container', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    // Mock the YT.Player constructor
    const mockPlayerInstance = {
      playVideo: jest.fn(),
      pauseVideo: jest.fn(),
      destroy: jest.fn(),
    };
    window.YT.Player = jest.fn().mockImplementation(() => mockPlayerInstance);

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    expect(container.querySelector('iframe')).not.toBeNull();
    expect(element.querySelector('iframe')).toBeNull();
    expect(window.YT.Player).toHaveBeenCalled();
  });

  it('should dispatch play and pause events on the container', async () => {
    const element = createVideoElement();
    const container = document.createElement('div');
    const player = new YouTubePlayer(element, container);

    let onStateChangeCallback: (event: { data: number }) => void = () => {};

    const mockPlayerInstance = {
      playVideo: jest.fn(),
      pauseVideo: jest.fn(),
      destroy: jest.fn(),
    };
    window.YT.Player = jest.fn().mockImplementation((iframe, options) => {
      onStateChangeCallback = options.events.onStateChange;
      return mockPlayerInstance;
    });

    player.load('https://www.youtube.com/watch?v=VIDEO_ID');
    await player.onReady;

    const playSpy = jest.spyOn(container, 'dispatchEvent');
    onStateChangeCallback({ data: global.YT.PlayerState.PLAYING });
    expect(playSpy).toHaveBeenCalledWith(new Event('play'));

    const pauseSpy = jest.spyOn(container, 'dispatchEvent');
    onStateChangeCallback({ data: global.YT.PlayerState.PAUSED });
    expect(pauseSpy).toHaveBeenCalledWith(new Event('pause'));
  });
});
