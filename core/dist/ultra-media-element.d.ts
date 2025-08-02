import { SuperVideoElement } from 'super-media-element';
import { Format } from './core/format';
declare const UltraMediaElement_base: import('media-tracks').WithMediaTracks<typeof SuperVideoElement>;
/**
 * Ultra Media Element supporting HLS, DASH, MP4 and MP3.
 *
 * @element ultra-media
 * @attr {string} src - Source URL for the media
 */
export declare class UltraMediaElement extends UltraMediaElement_base {
    private player;
    static skipAttributes: string[];
    isLive: boolean;
    loadComplete?: Promise<void>;
    isLoaded: boolean;
    constructor();
    private setupTrackListeners;
    connectedCallback(): Promise<void>;
    static get observedAttributes(): string[];
    attributeChangedCallback(attrName: string, oldValue: string, newValue: string): Promise<void>;
    private initializePlayer;
    private removeAllMediaTracks;
    changeSource(newSrc: string): Promise<void>;
    getCurrentFormat(): Format | undefined;
    private destroyPlayer;
}
export {};
