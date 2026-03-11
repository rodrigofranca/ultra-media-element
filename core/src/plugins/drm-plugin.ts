import { IPlugin, IPluginContext } from "../core/plugin-system";

export interface DrmConfig {
    keySystems: {
        [keySystem: string]: {
            licenseUrl: string;
            certificateUrl?: string;
            licenseHeaders?: Record<string, string>;
        }
    }
}

export class DrmPlugin implements IPlugin {
    name = "drm-plugin";
    private config: DrmConfig | null = null;
    private currentMediaConfig: DrmConfig | null = null;

    constructor(config?: DrmConfig) {
        this.config = config || null;
    }

    onAttach(context: IPluginContext) {
        // If config was passed during registration, use it
        if (context.config) {
            this.config = context.config;
        }
        console.log("[DrmPlugin] Attached with config:", this.config);
    }

    onMediaChange(media: any) {
        if (media && media.drm) {
            this.currentMediaConfig = media.drm;
            console.log("[DrmPlugin] Media config updated:", this.currentMediaConfig);
        } else {
            this.currentMediaConfig = null;
        }
    }

    private getEffectiveConfig(): DrmConfig | null {
        // Media config takes precedence over global config
        if (this.currentMediaConfig) {
            return this.currentMediaConfig;
        }
        return this.config;
    }

    onHlsConfig(hlsConfig: any) {
        const config = this.getEffectiveConfig();
        if (!config) return;

        console.log("[DrmPlugin] Configuring HLS DRM");

        // Map unified config to HLS.js drmSystems (v1.0+) or emeController
        // Using drmSystems which is the modern way in hls.js
        hlsConfig.drmSystems = {};

        const systems = config.keySystems;

        if (systems['com.widevine.alpha']) {
            hlsConfig.drmSystems['com.widevine.alpha'] = {
                licenseUrl: systems['com.widevine.alpha'].licenseUrl,
                serverCertificateUrl: systems['com.widevine.alpha'].certificateUrl,
                httpRequestHeaders: systems['com.widevine.alpha'].licenseHeaders
            };
        }

        if (systems['com.microsoft.playready']) {
            hlsConfig.drmSystems['com.microsoft.playready'] = {
                licenseUrl: systems['com.microsoft.playready'].licenseUrl,
                httpRequestHeaders: systems['com.microsoft.playready'].licenseHeaders
            };
        }
    }

    onDashConfig(dashConfig: any) {
        // Dash.js usually configures protection via setProtectionData, 
        // but we can also set it in the initial config if supported, 
        // or we can use onDashInstance to call setProtectionData.
        // Let's use onDashInstance for Dash.js as it's the standard API.
    }

    onDashInstance(player: any) {
        const config = this.getEffectiveConfig();
        if (!config) return;

        console.log("[DrmPlugin] Configuring Dash DRM");

        const protectionData: any = {};
        const systems = config.keySystems;

        if (systems['com.widevine.alpha']) {
            protectionData['com.widevine.alpha'] = {
                serverURL: systems['com.widevine.alpha'].licenseUrl,
                httpRequestHeaders: systems['com.widevine.alpha'].licenseHeaders
            };
        }

        if (systems['com.microsoft.playready']) {
            protectionData['com.microsoft.playready'] = {
                serverURL: systems['com.microsoft.playready'].licenseUrl,
                httpRequestHeaders: systems['com.microsoft.playready'].licenseHeaders
            };
        }

        player.setProtectionData(protectionData);
    }
}
