import { IMediaPlayer } from "./media-player";

export interface IPluginContext {
  player: IMediaPlayer;
  element: HTMLElement;
  config?: any;
}

export interface IPlugin {
  name: string;
  version?: string;

  // Lifecycle methods
  onAttach?(context: IPluginContext): void;
  onDetach?(context: IPluginContext): void;

  // Engine specific hooks (for DRM/Advanced config)
  onHlsConfig?(config: any): void;
  onHlsInstance?(hls: any): void;

  onDashConfig?(config: any): void;
  onDashInstance?(dash: any): void;

  // Event interception
  onEvent?(event: string, data: any): void;

  // Media context change
  onMediaChange?(media: any): void;
}

export class PluginManager {
  private plugins: Map<string, IPlugin> = new Map();
  private context: IPluginContext | null = null;

  constructor(element: HTMLElement) {
    // Initial context with a dummy player until the real one is loaded
    this.context = {
      element,
      player: {
        onReady: Promise.resolve(),
        load: () => { },
        destroy: () => { },
      }
    };
  }

  register(plugin: IPlugin, config?: any) {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin ${plugin.name} is already registered.`);
      return;
    }

    this.plugins.set(plugin.name, plugin);

    if (this.context) {
      // Update context with specific config for this plugin if provided
      const pluginContext = { ...this.context, config };
      plugin.onAttach?.(pluginContext);
    }
  }

  unregister(pluginName: string) {
    const plugin = this.plugins.get(pluginName);
    if (plugin && this.context) {
      plugin.onDetach?.(this.context);
    }
    this.plugins.delete(pluginName);
  }

  updatePlayer(player: IMediaPlayer) {
    if (!this.context) return;

    this.context.player = player;

    // Notify all plugins about the new player context if needed
    // Ideally, onAttach is called once, but if player instance changes (e.g. format switch),
    // we might need a way to re-notify or just let the hooks handle it.
    // For now, let's assume plugins hook into the player instance they got in onAttach.
    // If the player instance is replaced, we might need to re-attach plugins?
    // A simpler approach for this MVP:
    // When player changes, we might want to call a specific hook or just rely on the fact 
    // that the element is the same, but the underlying engine changed.

    // Let's iterate and update if plugins support a "onPlayerChange" or similar, 
    // but for now, the critical part is exposing the engine instances (HLS/Dash) 
    // which happens via specific methods called by the player itself.
  }

  // Methods called by the Player implementations to notify plugins
  notifyHlsConfig(config: any) {
    this.plugins.forEach(plugin => plugin.onHlsConfig?.(config));
  }

  notifyHlsInstance(hls: any) {
    this.plugins.forEach(plugin => plugin.onHlsInstance?.(hls));
  }

  notifyDashConfig(config: any) {
    this.plugins.forEach(plugin => plugin.onDashConfig?.(config));
  }

  notifyDashInstance(dash: any) {
    this.plugins.forEach(plugin => plugin.onDashInstance?.(dash));
  }

  notifyEvent(event: string, data: any) {
    this.plugins.forEach(plugin => plugin.onEvent?.(event, data));
  }

  notifyMediaChange(media: any) {
    this.plugins.forEach(plugin => plugin.onMediaChange?.(media));
  }

  destroy() {
    if (this.context) {
      this.plugins.forEach(plugin => plugin.onDetach?.(this.context!));
    }
    this.plugins.clear();
    this.context = null;
  }
}
