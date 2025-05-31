import type { IMediaPlayer, AvailableFormats } from "./media-player";
import { detectFormat } from "./format-detector";
import { Format } from "./format";
import { HlsPlayer } from "../players/hls-player";
import { VideoPlayer } from "../players/video-player";
import { DashPlayer } from "../players/dash-player";
import { AudioPlayer } from "../players/audio-player";

export type PlayerFactoryProps = {
  src: string;
  element: HTMLMediaElement;
  formats?: AvailableFormats;
};

const DEFAULT_FORMATS: AvailableFormats = {
  [Format.HLS]: "hls.js",
  [Format.MP4]: "video/mp4",
  [Format.DASH]: "dash.js",
  [Format.AUDIO]: "audio/mp3"
};

const engines = new Map<string, (el: HTMLVideoElement) => IMediaPlayer>([
  ["hls.js", (el) => new HlsPlayer(el)],
  ["video/mp4", (el) => new VideoPlayer(el)],
  ["dash.js", (el) => new DashPlayer(el)],
  ["audio/mp3", (el) => new AudioPlayer(el)]
]);

export function getCurrentFormatFromElement(el: HTMLMediaElement): Format | undefined {
  const type = el.dataset?.type;

  const map: Record<string, Format> = {
    'hls.js': Format.HLS,
    'dash.js': Format.DASH,
    'video/mp4': Format.MP4,
    'audio/mp3': Format.AUDIO
  };

  return type ? map[type] : undefined;
}

export class PlayerFactory {
  static create({ src, element, formats }: PlayerFactoryProps): IMediaPlayer {
    const engineType = this.resolveEngine(src, formats ?? DEFAULT_FORMATS);
    const engine = engines.get(engineType);

    if (!engine) {
      throw new Error(`No engine registered for: ${engineType}`);
    }

    element.dataset.type = engineType;
    const player = engine(element as HTMLVideoElement);

    player.onReady.then(() => player.load(src));
    return player;
  }

  private static resolveEngine(src: string, formats: AvailableFormats): string {
    const format = detectFormat(src);

    if (!format) {
      throw new Error(`Unsupported media source: ${src}`);
    }

    const engine = formats[format];

    if (!engine) {
      throw new Error(`Format ${format} is not configured in formats`);
    }

    return engine;
  }
}