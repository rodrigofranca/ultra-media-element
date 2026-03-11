import type { IMediaPlayer, AvailableFormats } from "./media-player";
import { detectFormat } from "./format-detector";
import { Format } from "./format";
import { HlsPlayer } from "../players/hls-player";
import { VideoPlayer } from "../players/video-player";
import { DashPlayer } from "../players/dash-player";
import { AudioPlayer } from "../players/audio-player";
import { YouTubePlayer } from "../players/youtube-player";
import { PluginManager } from "./plugin-system";

export type PlayerFactoryProps = {
  src: string;
  element: HTMLMediaElement;
  container?: HTMLElement;
  formats?: AvailableFormats;
  pluginManager?: PluginManager;
};

const DEFAULT_FORMATS: AvailableFormats = {
  [Format.HLS]: "hls.js",
  [Format.MP4]: "video/mp4",
  [Format.DASH]: "dash.js",
  [Format.AUDIO]: "audio/mp3",
  [Format.YOUTUBE]: "youtube",
};

const engines = new Map<string, (el: HTMLVideoElement, container?: HTMLElement, pluginManager?: PluginManager) => IMediaPlayer>([
  ["hls.js", (el, _, pluginManager) => new HlsPlayer(el, pluginManager)],
  ["video/mp4", (el) => new VideoPlayer(el)],
  ["dash.js", (el, _, pluginManager) => new DashPlayer(el, pluginManager)],
  ["audio/mp3", (el) => new AudioPlayer(el)],
  ["youtube", (el, container) => new YouTubePlayer(el, container as HTMLElement)],
]);

export function getCurrentFormatFromElement(el: HTMLMediaElement): Format | undefined {
  const type = el.dataset?.type;

  const map: Record<string, Format> = {
    'hls.js': Format.HLS,
    'dash.js': Format.DASH,
    'video/mp4': Format.MP4,
    'audio/mp3': Format.AUDIO,
    'youtube': Format.YOUTUBE,
  };

  return type ? map[type] : undefined;
}

export class PlayerFactory {
  static create({ src, element, container, formats, pluginManager }: PlayerFactoryProps): IMediaPlayer {
    const engineType = this.resolveEngine(src, formats ?? DEFAULT_FORMATS);
    const engine = engines.get(engineType);

    if (!engine) {
      throw new Error(`No engine registered for: ${engineType}`);
    }

    element.dataset.type = engineType;
    let playerContainer = container;
    if (engineType === 'youtube' && !playerContainer) {
      playerContainer = element.parentElement as HTMLElement;
      if (!playerContainer) {
        throw new Error('YouTube player requires a container element.');
      }
    }
    const player = engine(element as HTMLVideoElement, playerContainer, pluginManager);

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