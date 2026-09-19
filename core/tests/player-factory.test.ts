import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { PlayerFactory } from "../src/core/player-factory";
import { VideoPlayer } from "../src/players/video-player";
import { HlsPlayer } from "../src/players/hls-player";
import { YouTubePlayer } from '../src/players/youtube-player';
import { Format } from "../src/core/format";

function createVideoElement(): HTMLVideoElement {
  return document.createElement("video");
}

describe("PlayerFactory", () => {
  afterEach(() => {
    // loadSDK/loadYouTubeAPI resolve immediately when the SDK global is
    // already present on window, so tests seed it instead of hitting the
    // network (jsdom never actually executes injected <script> tags).
    delete (window as any).Hls;
    delete (window as any).YT;
  });

  it("creates a VideoPlayer for mp4", async () => {
    const element = createVideoElement();
    const player = PlayerFactory.create({
      src: "https://example.com/video.mp4",
      element,
    });

    expect(player).toBeInstanceOf(VideoPlayer);
    await expect(player.onReady).resolves.toBeUndefined();
  });

  it("creates an HlsPlayer for .m3u8", async () => {
    (window as any).Hls = jest.fn().mockImplementation(() => ({
      attachMedia: jest.fn(),
      on: jest.fn(),
      loadSource: jest.fn(),
    }));
    (window as any).Hls.Events = { ERROR: "hlsError", MANIFEST_PARSED: "hlsManifestParsed" };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);

    const element = createVideoElement();
    const player = PlayerFactory.create({
      src: "https://example.com/video.m3u8",
      element,
      container: document.createElement("div"),
    });

    expect(player).toBeInstanceOf(HlsPlayer);
    await expect(player.onReady).resolves.toBeUndefined();
  });

  it("creates a YouTubePlayer for youtube.com URL", async () => {
    (window as any).YT = { Player: jest.fn() };

    const element = createVideoElement();
    const player = PlayerFactory.create({
      src: "https://www.youtube.com/watch?v=VIDEO_ID",
      element,
      container: document.createElement("div"),
    });

    expect(player).toBeInstanceOf(YouTubePlayer);
    await expect(player.onReady).resolves.toBeUndefined();
  });

  it("throws error for unsupported format", () => {
    const element = createVideoElement();
    expect(() =>
      PlayerFactory.create({
        src: "https://example.com/video.xyz",
        element,
      })
    ).toThrow("Unsupported media source");
  });

  it("throws error if no engine configured for detected format", () => {
    const element = createVideoElement();
    expect(() =>
      PlayerFactory.create({
        src: "https://example.com/video.mp4",
        element,
        formats: { [Format.MP4]: "unknown/engine" },
      })
    ).toThrow("No engine registered for: unknown/engine");
  });
});
