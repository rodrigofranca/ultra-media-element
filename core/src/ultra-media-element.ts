import type { IMediaPlayer, MediaTracks } from './core/media-player';
import { SuperVideoElement } from 'super-media-element';
import { MediaTracksMixin } from 'media-tracks';
import { getCurrentFormatFromElement, PlayerFactory } from './core/player-factory';
import { Format } from './core/format';
import { detectFormat } from './core/format-detector';

/**
 * Ultra Media Element supporting HLS, DASH, MP4 and MP3.
 *
 * @element ultra-media
 * @attr {string} src - Source URL for the media
 */
export class UltraMediaElement extends MediaTracksMixin(SuperVideoElement) {

  private player: IMediaPlayer | null = null;
  static skipAttributes = ['src'];
  public isLive = false;
  public declare loadComplete?: Promise<void>;
  public declare isLoaded: boolean;

  constructor() {
    super();
    this.setupTrackListeners();
  }

  private setupTrackListeners() {
    this.audioTracks.onchange = () => {
      const enabledTrack = [...this.audioTracks].find(track => track.enabled);
      if (enabledTrack && this.player?.switchAudioTrack) {
        this.player.switchAudioTrack(enabledTrack.id);
      }
    };

    this.videoRenditions.onchange = () => {
      const selectedRendition = [...this.videoRenditions].find(rendition => rendition.selected);
      if (selectedRendition?.id && this.player?.switchRendition) {
        this.player.switchRendition(selectedRendition.id);
      }
    };
  }

  async connectedCallback() {
    super.connectedCallback?.();
  }

  static get observedAttributes() {
    // Pega os atributos do SuperVideoElement e adiciona os novos
    return [...(super.observedAttributes ?? []), 'live'];
  }

  async attributeChangedCallback(attrName: string, oldValue: string, newValue: string) {
    super.attributeChangedCallback?.(attrName, oldValue, newValue);

    console.log(`UltraMediaElement: attributeChangedCallback called for ${attrName} from ${oldValue} to ${newValue}`);

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

    // Registra os eventos de tracks
    this.player.onTracksChange?.((tracks: MediaTracks) => {
      this.removeAllMediaTracks();

      if (tracks.audio) {
        tracks.audio.forEach((track) => {
          const audioTrack = this.addAudioTrack(track.kind || 'main', track.label, track.language);
          audioTrack.id = track.id;
          if (track.default) {
            audioTrack.enabled = true;
          }
        });
      }

      if (tracks.renditions) {
        const videoTrack = this.addVideoTrack('main');
        videoTrack.id = 'main';
        videoTrack.selected = true;

        tracks.renditions.forEach((rendition) => {
          const videoRendition = videoTrack.addRendition(
            '',
            rendition.width,
            rendition.height,
            rendition.codec,
            rendition.bitrate,
            rendition.frameRate
          );
          videoRendition.id = rendition.id;
        });
      }
    });
  }

  private removeAllMediaTracks() {
    for (const audioTrack of this.audioTracks) {
      this.removeAudioTrack(audioTrack);
    }
    for (const videoTrack of this.videoTracks) {
      this.removeVideoTrack(videoTrack);
    }
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
