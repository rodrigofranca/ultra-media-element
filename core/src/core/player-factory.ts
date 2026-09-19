import type { IMediaPlayer, AvailableFormats, MediaPlayerError } from "./media-player";
import { detectFormat } from "./format-detector";
import { Format } from "./format";
import { HlsPlayer } from "../players/hls-player";
import { VideoPlayer } from "../players/video-player";
import { DashPlayer } from "../players/dash-player";
import { AudioPlayer } from "../players/audio-player";
import { YouTubePlayer } from "../players/youtube-player";

export type PlayerFactoryProps = {
  src: string;
  element: HTMLMediaElement;
  // A plain Node (e.g. a ShadowRoot), not HTMLElement - see
  // UltraMediaCoreOptions.container's comment (ultra-media-core.ts).
  container?: Node;
  formats?: AvailableFormats;
  /** Explicit format override - skips detectFormat(src). Used by UltraMediaCore.load({ src, type }). */
  format?: Format;
};

const DEFAULT_FORMATS: AvailableFormats = {
  [Format.HLS]: "hls.js",
  [Format.MP4]: "video/mp4",
  [Format.DASH]: "dash.js",
  [Format.AUDIO]: "audio/mp3",
  [Format.YOUTUBE]: "youtube",
};

// A YouTube source with no `container` used to throw synchronously out of
// PlayerFactory.create() - a path UltraMediaCore.load() never wraps in
// try/catch, so it escaped as an uncaught exception instead of the normal
// fatal->`error`/`ready`-rejects routing every other engine's failure goes
// through (see result-cycle2.md, defect 8). This stub is a real
// IMediaPlayer whose onReady rejects and whose onError reports the same
// MediaPlayerError - deferred to a microtask so UltraMediaCore.wireUp()
// (called right after PlayerFactory.create() returns) has already
// registered its onError listener by the time it fires.
function containerRequiredPlayer(src: string): IMediaPlayer {
  let onError: ((error: MediaPlayerError) => void) | undefined;
  const error: MediaPlayerError = {
    fatal: true,
    category: 'otherError',
    code: 'CONTAINER_REQUIRED',
    message: 'YouTubePlayer requires a container element',
    engine: 'youtube',
    url: src,
  };
  return {
    // `queueMicrotask` doesn't exist on the ~ES2017 Smart TV runtimes this
    // targets (see result-cycle3.md, defect 4) - `Promise.resolve().then()`
    // schedules on the same microtask queue without it.
    onReady: new Promise((_resolve, reject) => {
      Promise.resolve().then(() => {
        onError?.(error);
        reject(error);
      });
    }),
    onError: (cb) => { onError = cb; },
    load: () => {},
    destroy: () => {},
  };
}

const engines = new Map<string, (el: HTMLVideoElement, container?: Node, src?: string) => IMediaPlayer>([
  ["hls.js", (el) => new HlsPlayer(el)],
  ["video/mp4", (el) => new VideoPlayer(el)],
  ["dash.js", (el) => new DashPlayer(el)],
  ["audio/mp3", (el) => new AudioPlayer(el)],
  ["youtube", (el, container, src) => (container ? new YouTubePlayer(el, container) : containerRequiredPlayer(src!))],
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
  static create({ src, element, container, formats, format }: PlayerFactoryProps): IMediaPlayer {
    const engineType = this.resolveEngine(src, formats ?? DEFAULT_FORMATS, format);
    const engine = engines.get(engineType);

    if (!engine) {
      throw new Error(`No engine registered for: ${engineType}`);
    }

    element.dataset.type = engineType;
    const player = engine(element as HTMLVideoElement, container, src);

    // Call load() synchronously instead of chaining it onto `onReady`: every
    // player now queues the src internally and applies it once actually
    // ready (see e.g. HlsPlayer/DashPlayer's `pendingSrc`), which is what
    // lets a later load() (a src change before the SDK finished loading)
    // safely overwrite this one instead of racing it - the old
    // `onReady.then(() => player.load(src))` fired with this closure's
    // stale `src` *after* any such later call, always re-loading the wrong,
    // stale source once the SDK caught up. See result.md "decisões de
    // design".
    player.load(src);
    return player;
  }

  private static resolveEngine(src: string, formats: AvailableFormats, explicitFormat?: Format): string {
    const format = explicitFormat ?? detectFormat(src);

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