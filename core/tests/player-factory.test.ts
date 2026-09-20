import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { PlayerFactory } from "../src/core/player-factory";
import { VideoPlayer } from "../src/players/video-player";
import { HlsPlayer } from "../src/players/hls-player";
import { YouTubePlayer } from '../src/players/youtube-player';
import { Format } from "../src/core/format";
import type { MediaPlayerError } from "../src/core/media-player";

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

  // cycle 2, defect 8: a YouTube source with no `container` used to throw
  // synchronously out of create() - a codepath UltraMediaCore.load() never
  // wraps in try/catch, so it escaped as an uncaught exception instead of
  // going through the normal fatal-error routing every other engine uses.
  // It must behave like any other fatal failure instead: no throw, a
  // player whose onReady rejects and whose onError reports the same
  // MediaPlayerError shape (both consumed by UltraMediaCore.wireUp()).
  it("a YouTube source with no container does not throw - onReady rejects and onError reports a fatal CONTAINER_REQUIRED error", async () => {
    const element = createVideoElement();

    let player: ReturnType<typeof PlayerFactory.create> | undefined;
    expect(() => {
      player = PlayerFactory.create({
        src: "https://www.youtube.com/watch?v=VIDEO_ID12",
        element,
      });
    }).not.toThrow();

    const reported: MediaPlayerError[] = [];
    player!.onError?.((error) => reported.push(error));

    await expect(player!.onReady).rejects.toMatchObject({ fatal: true, code: 'CONTAINER_REQUIRED', engine: 'youtube' });
    expect(reported).toEqual([
      expect.objectContaining({ fatal: true, code: 'CONTAINER_REQUIRED', engine: 'youtube' }),
    ]);
  });

  // cycle 3, defect 1: create() used to write `element.dataset.type` as its
  // only way to report the resolved engine back to UltraMediaCore - on a
  // <video> owned by a host, that clobbered any `data-type` attribute the
  // host already had for its own purposes. resolveEngine() (exposed below)
  // lets a caller learn the same resolution without touching the DOM at
  // all, so create() no longer needs to write anything there.
  it("does not write a data-type attribute on the element - engine identity never touches the DOM", () => {
    const element = createVideoElement();
    element.dataset.type = 'do-host';

    PlayerFactory.create({ src: "https://example.com/video.mp4", element });

    expect(element.dataset.type).toBe('do-host');
  });

  // ADR-0001 D4 - create() forwards `requestPolicy` both to the engine's
  // constructor (needed by hls.js/dash.js, whose setup is async) and to the
  // load() call it makes internally.
  it("forwards requestPolicy to HlsPlayer's construction", async () => {
    let config: any;
    (window as any).Hls = jest.fn().mockImplementation((cfg: any) => {
      config = cfg;
      return { attachMedia: jest.fn(), on: jest.fn(), loadSource: jest.fn() };
    });
    (window as any).Hls.Events = { ERROR: "hlsError", MANIFEST_PARSED: "hlsManifestParsed" };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);

    const element = createVideoElement();
    const player = PlayerFactory.create({
      src: "https://example.com/video.m3u8",
      element,
      container: document.createElement("div"),
      requestPolicy: { headers: { Authorization: 'Bearer t' } },
    });
    await player.onReady;

    const context: any = { url: 'https://example.com/video.m3u8', type: 'manifest' };
    config.xhrSetup({ setRequestHeader: jest.fn() }, context.url, context);
    expect(context.headers).toEqual({ Authorization: 'Bearer t' });
  });

  it("resolveEngine() returns the same engine name create() would pick, without creating a player", () => {
    expect(PlayerFactory.resolveEngine("https://example.com/video.mp4")).toBe('video/mp4');
    expect(PlayerFactory.resolveEngine("https://example.com/video.m3u8")).toBe('hls.js');
    expect(PlayerFactory.resolveEngine("https://example.com/video.mpd")).toBe('dash.js');
    expect(PlayerFactory.resolveEngine("https://www.youtube.com/watch?v=VIDEO_ID", undefined, Format.YOUTUBE)).toBe('youtube');
  });
});
