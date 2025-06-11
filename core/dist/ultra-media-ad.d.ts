export declare class UltraMediaAd extends HTMLElement {
    private videoElement;
    private videoElementId;
    private adPlayer;
    private muteOnly;
    private resizeObserver;
    private injectStyle;
    constructor();
    connectedCallback(): void;
    static get observedAttributes(): string[];
    attributeChangedCallback(attrName: string, oldValue: any, newValue: any): void;
    setupAd(position: string): void;
    playAdOnce(event: Event): Promise<void>;
    private handleResize;
    disconnectedCallback(): void;
}
export declare const events: string[];
