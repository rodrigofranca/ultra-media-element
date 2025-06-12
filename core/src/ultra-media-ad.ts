//@ts-ignore
import ImaAdPlayer from 'ima-ad-player';

export class UltraMediaAd extends HTMLElement {
  private videoElement: HTMLVideoElement | null = null;
  private videoElementId: string = '';
  private adPlayer: any = null;
  private muteOnly: boolean = false;
  private resizeObserver: ResizeObserver | null = null;

  private injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: none;
      }
      :host(.visible) {
        display: flex;
      }
    `;
    this.shadowRoot?.appendChild(style);
  }

  constructor() {
    super();
  }

  connectedCallback() {
    this.attachShadow({mode: 'open'});
    this.injectStyle();

    this.muteOnly = this.hasAttribute('mute-only');

    const adTagUrl = this.getAttribute('ad-tag-url');
    const position = this.getAttribute('position') || 'pre-roll';
    if (!adTagUrl) {
      console.error('UltraMediaAd: Missing "ad-tag-url" attribute.');
      return;
    }

    // Configuração do IMA Ad Player
    const config = {
      video: this.videoElement,
      displayContainer: this.shadowRoot,
      tag: adTagUrl,
      adsRenderingOptions: {
        useStyledLinearAds: true,
        useStyledNonLinearAds: true,
      }
    };

    if (!this.videoElement) {
      const parentMediaElement = this.parentElement;
      this.videoElement = getNativeVideoElement(parentMediaElement);

      if (!this.videoElement) {
        console.error('UltraMediaAd: No compatible video element found in parent.');
        return;
      }
    }

    // Setup resize observer
    this.resizeObserver = new ResizeObserver(this.handleResize.bind(this));
    this.resizeObserver.observe(this);

    ImaAdPlayer(config, (player: any, error: any) => {
      if (error) {
        console.error('UltraMediaAd: Error initializing ad player', error);
        return;
      }

      this.adPlayer = player;

      // Propagar todos os eventos do IMA SDK
      events.forEach((event) => {
        player.on(event, (data: any) => {
          const customEvent = new CustomEvent(event, {
            bubbles: true,
            composed: true,
            detail: data
          });
          this.dispatchEvent(customEvent);
        });
      });

      // Pause video immediately to prepare for pre-roll
      if(this.videoElement){
        if(this.muteOnly) {
          this.videoElement.muted = true;
        }else{
          this.videoElement?.pause();
        }
      }
      this.classList.remove('visible'); // Inicialmente invisível

      events.forEach((event) => {
        player.on(event, () => {
          console.log('Ad event:', event);
        });
      });

      player.on('ad_begin', () => {
        this.classList.add('visible');
        if(!this.videoElement) return
        if(this.muteOnly) {
          this.videoElement.muted = true;
        }else{
          this.videoElement?.pause();
        }
      });

      player.on('ad_end', () => {
        this.classList.remove('visible');
        if(!this.videoElement) return
        if (this.muteOnly) {
          this.videoElement.muted = false;
        } else {
          this.videoElement.play();
        }
      });

      player.on('error', () => {
        this.classList.remove('visible');
        if(!this.videoElement) return
        if (this.muteOnly) {
          this.videoElement.muted = false;
        } else {
          this.videoElement.play();
        }
      });

      this.setupAd(position);
    });
  }

  static get observedAttributes() {
    return ['video','model','ad-tag-url','position'];
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
    if(this.videoElement){
      if (this.muteOnly) {
        this.videoElement.muted = false;
      } else {
        this.videoElement.play();
      }
    }
    try {
      await this.adPlayer.play();
    } catch (error) {
      console.error('UltraMediaAd: Error playing ad', error);
      this.videoElement?.play();
    }
  }

  private handleResize(entries: ResizeObserverEntry[]) {
    if (!this.adPlayer) return;

    const entry = entries[0];
    const width = entry.contentRect.width;
    const height = entry.contentRect.height;

    this.adPlayer.resize(width, height);
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
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
  'first_quartile',
  'midpoint',
  'third_quartile',
  'click',
  'volume_changed',
  'volume_muted',
  'skipped',
  'started',
  'complete',
  'all_ads_completed'
];