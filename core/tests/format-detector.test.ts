import { describe, it, expect } from '@jest/globals';
import { detectFormat } from "../src/core/format-detector";
import { Format } from "../src/core/format";

describe("detectFormat", () => {
  it("detects HLS format", () => {
    expect(detectFormat("video.m3u8")).toBe(Format.HLS);
  });

  it("detects DASH format", () => {
    expect(detectFormat("video.mpd")).toBe(Format.DASH);
  });

  it("detects MP4 format", () => {
    expect(detectFormat("video.mp4")).toBe(Format.MP4);
  });

  it("detects AUDIO format", () => {
    expect(detectFormat("music.mp3")).toBe(Format.AUDIO);
  });

  it("returns undefined for unknown formats", () => {
    expect(detectFormat("video.unknown")).toBeUndefined();
  });
});