import { SuperVideoElement } from 'super-media-element';
import { getCurrentFormatFromElement, PlayerFactory } from './core/player-factory';
import { Format } from './core/format';
import { detectFormat } from './core/format-detector';
import type { IMediaPlayer } from './core/media-player';

/**
 * Ultra Media Element supporting HLS, DASH, MP4 and MP3.
 *
 * @element ultra-media
 * @attr {string} src - Source URL for the media
 */
export class UltraMediaElement extends SuperVideoElement {

  private player: IMediaPlayer | null = null;  
  static skipAttributes = ['src'];
  public test: string = 'test';
  
  constructor() {
    super();
  }

  async connectedCallback() {
    super.connectedCallback?.();

    if (this.loadComplete && !this.isLoaded) {
      await this.loadComplete;
    }

    this.initializePlayer();
  }

  async attributeChangedCallback(attrName: string, oldValue: string, newValue: string) {
    super.attributeChangedCallback?.(attrName, oldValue, newValue);

    if (attrName === 'src' && oldValue !== newValue) {
      if (this.loadComplete && !this.isLoaded) {
        await this.loadComplete;
      }

      const currentFormat = this.getCurrentFormat();
      const newFormat = detectFormat(newValue ?? '');

      if (currentFormat !== newFormat) {
        this.destroyPlayer();
      }

      if (this.player && currentFormat === newFormat) {
        this.player.load(newValue);
      } else {
        this.initializePlayer();
      }
    }
  }

  private initializePlayer() {
    if (!this.nativeEl || !this.src) {
      console.warn('[Ultra Media Element] nativeEl or src not available yet');
      return;
    }

    this.player = PlayerFactory.create({
      src: this.src,
      element: this.nativeEl,
    });
  }

  async changeSource(newSrc: string) {
    if (!newSrc) {
      console.warn('[Ultra Media Element] Invalid source');
      return;
    }

    this.setAttribute('src', newSrc);
  }

  getCurrentFormat(): Format | undefined {
    return this.nativeEl ? getCurrentFormatFromElement(this.nativeEl) : undefined;
  }

  private destroyPlayer() {
    if (this.player?.destroy) {
      this.player.destroy();
    }

    this.player = null;
  }
}
