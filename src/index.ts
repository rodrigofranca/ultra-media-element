import { UltraMediaElement } from './ultra-media-element';

const customElement = 'ultra-media';

if (
  globalThis.customElements &&
  !globalThis.customElements.get(customElement)
) {
  globalThis.customElements.define(customElement, UltraMediaElement);
}

export type { UltraMediaElement };
