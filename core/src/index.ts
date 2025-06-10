import { UltraMediaAd } from './ultra-media-ad';
import { UltraMediaElement } from './ultra-media-element';

const registerCustomElements = (tag: string, constructor: any) => {
  if (
    globalThis.customElements &&
    !globalThis.customElements.get(tag)
  ) {
    globalThis.customElements.define(tag, constructor);
  }
}

registerCustomElements('ultra-media', UltraMediaElement);
registerCustomElements('ultra-media-ad', UltraMediaAd);

export type { UltraMediaElement };
