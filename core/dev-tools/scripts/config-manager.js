/**
 * Configuration Manager - Ultra Media Element Development Tools
 * Manages player configurations and presets
 */

export class ConfigManager {
  constructor() {
    this.storageKey = 'ultra-media-dev-config';
    this.config = this.loadConfig();
    this.presets = this.getDefaultPresets();
    
    this.initialize();
  }

  initialize() {
    this.setupEventListeners();
    this.applyInitialConfig();
  }

  setupEventListeners() {
    // Listen for configuration changes
    document.addEventListener('change', (event) => {
      if (event.target.matches('#autoplay-toggle')) {
        this.updateConfig('player.autoplay', event.target.checked);
      } else if (event.target.matches('#muted-toggle')) {
        this.updateConfig('player.muted', event.target.checked);
      } else if (event.target.matches('#controls-toggle')) {
        this.updateConfig('player.controls', event.target.checked);
      } else if (event.target.matches('#playsinline-toggle')) {
        this.updateConfig('player.playsinline', event.target.checked);
      }
    });
  }

  loadConfig() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return this.deepMerge(this.getDefaultConfig(), parsed);
      }
    } catch (error) {
      console.warn('Failed to load saved config:', error);
    }
    
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      player: {
        autoplay: false,
        muted: true,
        controls: true,
        playsinline: true,
        crossorigin: 'anonymous'
      },
      devTools: {
        eventMonitorEnabled: false, // Start disabled by default
        performanceTrackingEnabled: true,
        realTimeUpdates: true,
        logLevel: 'info',
        maxEvents: 100
      },
      ui: {
        theme: 'dark',
        layout: 'desktop',
        sidebarCollapsed: false,
        autoSelectFirstSample: true,
        currentTab: 'media-library'
      },
      media: {
        currentUrl: '',
        currentSample: null,
        currentFormat: null
      },
      advanced: {
        hlsConfig: {},
        dashConfig: {},
        customAttributes: {}
      }
    };
  }

  getDefaultPresets() {
    return {
      'mobile-test': {
        name: 'Mobile Testing',
        description: 'Optimized for mobile device testing',
        config: {
          player: {
            autoplay: false,
            muted: true,
            controls: true,
            playsinline: true
          },
          ui: {
            layout: 'mobile'
          }
        }
      },
      'desktop-dev': {
        name: 'Desktop Development',
        description: 'Full desktop development environment',
        config: {
          player: {
            autoplay: true,
            muted: false,
            controls: true,
            playsinline: false
          },
          devTools: {
            realTimeUpdates: true,
            maxEvents: 200
          }
        }
      },
      'no-autoplay': {
        name: 'No Autoplay Policy',
        description: 'Simulates strict autoplay policy',
        config: {
          player: {
            autoplay: false,
            muted: true,
            controls: true
          }
        }
      },
      'accessibility': {
        name: 'Accessibility Testing',
        description: 'Focused on accessibility features',
        config: {
          player: {
            autoplay: false,
            muted: false,
            controls: true
          },
          ui: {
            theme: 'high-contrast'
          }
        }
      },
      'performance': {
        name: 'Performance Monitoring',
        description: 'Enhanced performance tracking',
        config: {
          devTools: {
            performanceTrackingEnabled: true,
            realTimeUpdates: true,
            maxEvents: 500
          }
        }
      }
    };
  }

  saveConfig() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  updateConfig(path, value) {
    const keys = path.split('.');
    let current = this.config;
    
    // Navigate to the parent object
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    // Set the final value
    current[keys[keys.length - 1]] = value;
    
    this.saveConfig();
    this.applyConfigChange(path, value);
    
    console.log(`🔧 Config updated: ${path} = ${value}`);
  }

  getConfig(path) {
    const keys = path.split('.');
    let current = this.config;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  applyInitialConfig() {
    // Apply player configuration to UI controls
    const controls = [
      { id: 'autoplay-toggle', path: 'player.autoplay' },
      { id: 'muted-toggle', path: 'player.muted' },
      { id: 'controls-toggle', path: 'player.controls' },
      { id: 'playsinline-toggle', path: 'player.playsinline' }
    ];

    controls.forEach(({ id, path }) => {
      const element = document.getElementById(id);
      if (element) {
        element.checked = this.getConfig(path);
      }
    });

    // Apply configuration to ultra-media element
    this.applyPlayerConfig();
  }

  applyConfigChange(path, value) {
    const ultraMedia = document.getElementById('ultra-media');
    if (!ultraMedia) return;

    try {
      if (path.startsWith('player.')) {
        const property = path.split('.')[1];
        
        switch (property) {
          case 'autoplay':
            ultraMedia.autoplay = value;
            break;
          case 'muted':
            ultraMedia.muted = value;
            break;
          case 'controls':
            ultraMedia.controls = value;
            break;
          case 'playsinline':
            ultraMedia.playsInline = value;
            break;
          case 'crossorigin':
            ultraMedia.crossOrigin = value;
            break;
        }
      }
    } catch (error) {
      console.error(`Failed to apply config change ${path}:`, error);
    }
  }

  applyPlayerConfig() {
    const ultraMedia = document.getElementById('ultra-media');
    if (!ultraMedia) return;

    try {
      const playerConfig = this.getConfig('player');
      
      ultraMedia.autoplay = playerConfig.autoplay;
      ultraMedia.muted = playerConfig.muted;
      ultraMedia.controls = playerConfig.controls;
      ultraMedia.playsInline = playerConfig.playsinline;
      ultraMedia.crossOrigin = playerConfig.crossorigin;
      
      console.log('🎛️ Player configuration applied');
    } catch (error) {
      console.error('Failed to apply player config:', error);
    }
  }

  loadPreset(presetName) {
    const preset = this.presets[presetName];
    if (!preset) {
      console.error(`Preset '${presetName}' not found`);
      return false;
    }

    try {
      // Merge preset config with current config
      this.config = this.deepMerge(this.config, preset.config);
      this.saveConfig();
      this.applyInitialConfig();
      
      console.log(`📋 Loaded preset: ${preset.name}`);
      return true;
    } catch (error) {
      console.error(`Failed to load preset '${presetName}':`, error);
      return false;
    }
  }

  exportConfig() {
    const exportData = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      config: this.config
    };
    
    return JSON.stringify(exportData, null, 2);
  }

  importConfig(configJson) {
    try {
      const imported = JSON.parse(configJson);
      
      if (imported.config) {
        this.config = { ...this.getDefaultConfig(), ...imported.config };
      } else {
        this.config = { ...this.getDefaultConfig(), ...imported };
      }
      
      this.saveConfig();
      this.applyInitialConfig();
      
      console.log('📥 Configuration imported successfully');
      return true;
    } catch (error) {
      console.error('Failed to import configuration:', error);
      return false;
    }
  }

  resetToDefaults() {
    this.config = this.getDefaultConfig();
    this.saveConfig();
    this.applyInitialConfig();
    
    console.log('🔄 Configuration reset to defaults');
  }

  // Utility function for deep merging objects
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(target[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  // Get configuration summary for display
  getConfigSummary() {
    return {
      player: this.getConfig('player'),
      devTools: this.getConfig('devTools'),
      ui: this.getConfig('ui')
    };
  }

  // Validate configuration
  validateConfig(config) {
    const defaultConfig = this.getDefaultConfig();
    
    // Basic structure validation
    const requiredSections = ['player', 'devTools', 'ui'];
    for (const section of requiredSections) {
      if (!config[section]) {
        config[section] = defaultConfig[section];
      }
    }
    
    return config;
  }


  // Public API
  getCurrentConfig() {
    return { ...this.config };
  }

  getAvailablePresets() {
    return Object.keys(this.presets).map(key => ({
      id: key,
      ...this.presets[key]
    }));
  }
}