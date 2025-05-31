// types/global.d.ts
import type { UltraMediaElement } from 'ultra-media-element';

declare global {
  interface HTMLElementTagNameMap {
    'ultra-media': UltraMediaElement;
  }

  namespace JSX {
    interface IntrinsicElements {
      'ultra-media': Partial<UltraMediaElement>
    }
  }
}

export type { UltraMediaElement };
