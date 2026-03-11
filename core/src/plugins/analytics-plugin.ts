import { IPlugin, IPluginContext } from "../core/plugin-system";

export class AnalyticsPlugin implements IPlugin {
    name = "analytics-plugin";
    private context: IPluginContext | null = null;

    onAttach(context: IPluginContext) {
        this.context = context;
        console.log("[AnalyticsPlugin] Attached");

        // Listen to standard media events
        const events = ['play', 'pause', 'ended', 'error', 'timeupdate'];
        events.forEach(event => {
            this.context?.element.addEventListener(event, (e) => this.logEvent(event, e));
        });
    }

    onDetach(context: IPluginContext) {
        console.log("[AnalyticsPlugin] Detached");
        this.context = null;
    }

    onHlsInstance(hls: any) {
        console.log("[AnalyticsPlugin] HLS Instance received", hls);
        // Example: Hook into HLS specific events
        hls.on('hlsManifestParsed', (event: any, data: any) => {
            console.log("[AnalyticsPlugin] HLS Manifest Parsed", data);
        });
    }

    onDashInstance(dash: any) {
        console.log("[AnalyticsPlugin] Dash Instance received", dash);
    }

    private logEvent(eventName: string, data: any) {
        if (eventName === 'timeupdate') return; // Too noisy
        console.log(`[AnalyticsPlugin] Event: ${eventName}`, data);
    }
}
