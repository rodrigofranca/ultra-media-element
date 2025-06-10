export interface IMediaPlayer {
    onReady: Promise<void>;
    load(src: string): void;
    destroy(): void;
}
export type AvailableFormats = {
    [key: string]: string;
};
