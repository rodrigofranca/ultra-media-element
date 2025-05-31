import { describe, it, expect } from '@jest/globals';
import { PlayerFactory } from "../src/core/player-factory";
import { VideoPlayer } from "../src/players/video-player";
import { HlsPlayer } from "../src/players/hls-player";
import { Format } from "../src/core/format";

function createVideoElement(): HTMLVideoElement {
  return document.createElement("video");
}

describe("PlayerFactory", () => {
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
    const element = createVideoElement();
    const player = PlayerFactory.create({
      src: "https://example.com/video.m3u8",
      element,
    });

    expect(player).toBeInstanceOf(HlsPlayer);
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
