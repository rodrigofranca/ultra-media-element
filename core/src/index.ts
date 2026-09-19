import { UltraMediaElement } from './ultra-media-element';
import { registerCustomElement } from './utils/register-custom-element';

registerCustomElement('ultra-media', UltraMediaElement);

export type { UltraMediaElement };
export type { MediaPlayerError } from './core/media-player';
