import type { MediaErrorCategory, MediaPlayerError } from "../core/media-player";

// The native HTMLMediaElement `error` event never exposes an HTTP status
// (browsers don't surface it for media resources), and every MediaError is
// terminal for the current source - there is no non-fatal case to route to
// `warning` here. Shared by video-player.ts and audio-player.ts, the two
// engines built directly on a native <video>/<audio> element.
const CODE_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

const CATEGORY_BY_CODE: Record<number, MediaErrorCategory> = {
  1: 'otherError',
  2: 'networkError',
  3: 'mediaError',
  4: 'mediaError',
};

export function mapNativeMediaError(mediaError: MediaError | null, engine: string, src: string): MediaPlayerError {
  const code = mediaError?.code ?? 0;
  const codeName = CODE_NAMES[code] ?? 'unknown';

  return {
    fatal: true,
    category: CATEGORY_BY_CODE[code] ?? 'otherError',
    code: codeName,
    message: mediaError?.message || codeName,
    engine,
    url: src || undefined,
    cause: mediaError ?? undefined,
  };
}
