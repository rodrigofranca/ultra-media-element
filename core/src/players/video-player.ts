import type { IMediaPlayer, MediaPlayerError } from "../core/media-player";
import { mapNativeMediaError } from "./native-media-error";

export class VideoPlayer implements IMediaPlayer {
  public onReady: Promise<void>;
  private errorHandler?: (e: Event) => void;

  constructor(private element: HTMLVideoElement) {
    this.onReady = Promise.resolve();
  }

  load(src: string): void {
    this.element.src = src;
  }

  onError(callback: (error: MediaPlayerError) => void) {
    // Called once per load() by UltraMediaCore, which reuses this player
    // across same-format loads: replace the listener, never stack them.
    if (this.errorHandler) {
      this.element.removeEventListener('error', this.errorHandler);
    }
    this.errorHandler = () => {
      // The media element load algorithm resets `error` to null when a new
      // load starts, so an `error` event with no MediaError is a stale one
      // queued for the source that load superseded - not this load's.
      if (!this.element.error) return;
      callback(mapNativeMediaError(this.element.error, 'video/mp4', this.element.currentSrc || this.element.src));
    };
    this.element.addEventListener('error', this.errorHandler);
  }

  destroy(): void {
    if (this.errorHandler) {
      this.element.removeEventListener('error', this.errorHandler);
      this.errorHandler = undefined;
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
