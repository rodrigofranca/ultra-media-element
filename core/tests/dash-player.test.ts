import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { DashPlayer } from '../src/players/dash-player';
import type { MediaTracks } from '../src/core/media-player';

function createVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

const FAKE_REPRESENTATIONS = [
  { width: 480, height: 270, bandwidth: 173100, frameRate: 12, codecs: 'avc1.42c01f' },
  { width: 320, height: 180, bandwidth: 80822, frameRate: 12, codecs: 'avc1.42c015' },
];

function setupMocks() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const mockPlayerInstance = {
    initialize: jest.fn(),
    updateSettings: jest.fn(),
    on: jest.fn((event: string, cb: (...args: any[]) => void) => {
      handlers[event] = cb;
    }),
    getTracksFor: jest.fn().mockReturnValue([]),
    getRepresentationsByType: jest.fn().mockReturnValue(FAKE_REPRESENTATIONS),
    setRepresentationForTypeByIndex: jest.fn(),
    setCurrentTrack: jest.fn(),
  };

  const MediaPlayerFactory: any = jest.fn(() => ({ create: () => mockPlayerInstance }));
  MediaPlayerFactory.events = { ERROR: 'error', STREAM_INITIALIZED: 'streamInitialized' };

  (window as any).dashjs = { MediaPlayer: MediaPlayerFactory };

  return { handlers, mockPlayerInstance };
}

async function setupPlayer() {
  const { handlers, mockPlayerInstance } = setupMocks();
  const player = new DashPlayer(createVideoElement());
  await player.onReady;
  return { player, handlers, mockPlayerInstance };
}

describe('DashPlayer renditions', () => {
  afterEach(() => {
    delete (window as any).dashjs;
  });

  it('exposes one videoRendition per bitrate Representation, not per AdaptationSet', async () => {
    const { player, handlers } = await setupPlayer();
    const onTracksChange = jest.fn<(tracks: MediaTracks) => void>();
    player.onTracksChange(onTracksChange);

    handlers.streamInitialized();

    expect(onTracksChange).toHaveBeenCalledTimes(1);
    const tracks = onTracksChange.mock.calls[0][0] as MediaTracks;
    expect(tracks.renditions).toEqual([
      { id: '0', width: 480, height: 270, bitrate: 173100, frameRate: 12, codec: 'avc1.42c01f' },
      { id: '1', width: 320, height: 180, bitrate: 80822, frameRate: 12, codec: 'avc1.42c015' },
    ]);
  });

  it('switchRendition selects by the same index getRepresentationsByType returned', async () => {
    const { player, handlers, mockPlayerInstance } = await setupPlayer();
    player.onTracksChange(jest.fn());
    handlers.streamInitialized();

    player.switchRendition('1');

    expect(mockPlayerInstance.setRepresentationForTypeByIndex).toHaveBeenCalledWith('video', 1);
  });
});
