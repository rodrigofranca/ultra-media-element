import { Format } from "./format";

export function detectFormat(src: string): Format | undefined {
  const lower = src.toLowerCase();

  if (lower.includes(".m3u8")) return Format.HLS;
  if (lower.includes(".mpd")) return Format.DASH;
  if (/\.(mp4|webm|ogg)/.test(lower)) return Format.MP4;
  if (/\.(mp3|wav|ogg)/.test(lower)) return Format.AUDIO;

  return undefined;
}