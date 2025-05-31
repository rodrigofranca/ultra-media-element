import { SuperVideoElement } from 'super-media-element';
import { Format } from './core/format';
/**
 * Ultra Media Element supporting HLS, DASH, MP4 and MP3.
 *
 * @element ultra-media
 * @attr {string} src - Source URL for the media
 */
export declare class UltraMediaElement extends SuperVideoElement {
    private player;
    static skipAttributes: string[];
    test: string;
    constructor();
    connectedCallback(): Promise<void>;
    attributeChangedCallback(attrName: string, oldValue: string, newValue: string): Promise<void>;
    private initializePlayer;
    changeSource(newSrc: string): Promise<void>;
    getCurrentFormat(): Format | undefined;
    private destroyPlayer;
}
