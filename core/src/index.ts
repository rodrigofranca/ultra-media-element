import { UltraMediaAd } from './ultra-media-ad';
import { UltraMediaElement } from './ultra-media-element';
import { PluginManager, IPlugin, IPluginContext } from './core/plugin-system';
import { AnalyticsPlugin } from './plugins/analytics-plugin';
import { DrmPlugin, DrmConfig } from './plugins/drm-plugin';

const registerCustomElements = (tag: string, constructor: any) => {
  if (
    globalThis.customElements &&
    !globalThis.customElements.get(tag)
  ) {
    globalThis.customElements.define(tag, constructor);
  }
}

registerCustomElements('ultra-media', UltraMediaElement);
registerCustomElements('ultra-media-ad', UltraMediaAd);

export { UltraMediaElement, PluginManager, AnalyticsPlugin, DrmPlugin };
export type { IPlugin, IPluginContext, DrmConfig };
