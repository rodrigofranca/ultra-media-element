// types/global.d.ts
import type { UltraMediaElement } from '../dist/ultra-media-element';

declare global {
  interface HTMLElementTagNameMap {
    'ultra-media': UltraMediaElement;
    'ultra-media-ad': HTMLElement;
  }

  namespace JSX {
    interface IntrinsicElements {
      'ultra-media': Partial<UltraMediaElement>
      'ultra-media-ad': any;
    }
  }

  // Svelte 4 support
  namespace svelteHTML {
    interface IntrinsicElements {
      'ultra-media': { src?: string; controls?: boolean; autoplay?: boolean; muted?: boolean; [key: string]: any };
      'ultra-media-ad': { video?: string; 'ad-tag-url'?: string; 'mute-only'?: boolean; [key: string]: any };
    }
  }
}

// Svelte 5 support
declare module 'svelte/elements' {
  interface SvelteHTMLElements {
    'ultra-media': HTMLAttributes<HTMLElement> & { src?: string; controls?: boolean; autoplay?: boolean; muted?: boolean };
    'ultra-media-ad': HTMLAttributes<HTMLElement> & { video?: string; 'ad-tag-url'?: string; 'mute-only'?: boolean };
  }
}

export type { UltraMediaElement };
