//@ts-ignore
import ImaAdPlayer from 'ima-ad-player';
import { SuperVideoElement } from 'super-media-element';

export class UltraMediaAd extends SuperVideoElement {
  private videoElement: HTMLVideoElement | null = null;
  private videoElementId: string = '';
  private adPlayer: any = null;

  constructor() {
    super();
  }

  connectedCallback() {
    const adTagUrl = this.getAttribute('ad-tag-url');
    const position = this.getAttribute('position') || 'pre-roll';

    if (!adTagUrl) {
      console.error('UltraMediaAd: Missing "ad-tag-url" attribute.');
      return;
    }

    if (!this.videoElement) {
      const parentMediaElement = this.parentElement;
      this.videoElement = getNativeVideoElement(parentMediaElement);

      if (!this.videoElement) {
        console.error('UltraMediaAd: No compatible video element found in parent.');
        return;
      }
    }

    ImaAdPlayer({
      video: this.videoElement,
      displayContainer: this,
      tag: adTagUrl,
    }, (player: any, error: any) => {
      if (error) {
        console.error('UltraMediaAd: Error initializing ad player', error);
        return;
      }

      this.adPlayer = player;

      // Pause video immediately to prepare for pre-roll
      this.videoElement?.pause();

      events.forEach((event) => {
        player.on(event, () => {
          console.log('Ad event:', event);
        });
      });

      player.on('ad_begin', () => {
        console.log('Ad started');
        this.videoElement?.pause();
      });

      player.on('ad_end', () => {
        console.log('Ad ended');
        this.videoElement?.play();
      });

      this.setupAd(position);
    });
  }

  static get observedAttributes() {
    return ['video'];
  }

  attributeChangedCallback(attrName: string, oldValue: any, newValue: any) {
    if (attrName === 'video' && newValue) {
      this.videoElementId = newValue;
      const element = document.getElementById(this.videoElementId);

      if ((element as any)?.nativeEl instanceof HTMLVideoElement) {
        this.videoElement = (element as any).nativeEl;
      } else if (element instanceof HTMLVideoElement) {
        this.videoElement = element;
      } else {
        console.error(`UltraMediaAd: No compatible video element found with ID "${this.videoElementId}".`);
        this.videoElement = null;
      }
    }
  }

  setupAd(position: string) {
    if (position === 'pre-roll' && this.videoElement) {
      this.videoElement.addEventListener('play', this.playAdOnce.bind(this), { once: true });
    }
  }

  async playAdOnce(event: Event) {
    event.preventDefault();
    this.videoElement?.pause();
    try {
      await this.adPlayer.play();
    } catch (error) {
      console.error('UltraMediaAd: Error playing ad', error);
      this.videoElement?.play();
    }
  }

  disconnectedCallback() {
    this.adPlayer?.destroy();
  }
}

const getNativeVideoElement = (element: HTMLElement | null) => {
  if (!element) return null;
  if ((element as any)?.nativeEl instanceof HTMLVideoElement) {
    return (element as any).nativeEl;
  } else if (element instanceof HTMLVideoElement) {
    throw new Error('UltraMediaAd: HTMLVideoElement elements cannot be used with <slot />.');
  }

  return null;
}


export const events = [
  'ad_begin',
  'ad_end',
  'ad_non_linear',
  'ad_play',
  'ad_play_intent',
  'ad_request',
  'ad_request_intent',
  'ad_stop',
  'ad_stop_intent',
  'ads_manager',
  'ads_manager_loaded',
  'ads_rendering_settings',
  'error',
];
