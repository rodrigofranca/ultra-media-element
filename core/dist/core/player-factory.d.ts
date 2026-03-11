import { IMediaPlayer, AvailableFormats } from './media-player';
import { Format } from './format';
export type PlayerFactoryProps = {
    src: string;
    element: HTMLMediaElement;
    container?: HTMLElement;
    formats?: AvailableFormats;
};
export declare function getCurrentFormatFromElement(el: HTMLMediaElement): Format | undefined;
export declare class PlayerFactory {
    static create({ src, element, container, formats }: PlayerFactoryProps): IMediaPlayer;
    private static resolveEngine;
}
