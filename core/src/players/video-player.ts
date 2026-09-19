import type { IMediaPlayer, MediaPlayerError } from "../core/media-player";

export class VideoPlayer implements IMediaPlayer {
  public onReady: Promise<void>;
  private errorCallback?: (error: MediaPlayerError) => void;
  private errorHandler?: (e: Event) => void;

  constructor(private element: HTMLVideoElement) {
    this.onReady = Promise.resolve();
  }

  load(src: string): void {
    this.element.src = src;
  }

  onError(callback: (error: MediaPlayerError) => void) {
    this.errorCallback = callback;
    this.errorHandler = () => {
      const mediaError = this.element.error;
      callback({
        type: 'mediaError',
        details: mediaError?.message || 'unknown',
        fatal: true,
        statusCode: mediaError?.code,
        message: mediaError?.message,
      });
    };
    this.element.addEventListener('error', this.errorHandler);
  }

  destroy(): void {
    if (this.errorHandler) {
      this.element.removeEventListener('error', this.errorHandler);
    }
    // `element.src = ''` is itself a valid (if unusual) source per the HTML
    // spec and fires a real `error` event - removeAttribute + load() lets
    // the resource selection algorithm see there is nothing to load and
    // reset to NETWORK_EMPTY silently instead (see result.md "decisões de
    // design").
    this.element.removeAttribute('src');
    this.element.load();
  }
}
