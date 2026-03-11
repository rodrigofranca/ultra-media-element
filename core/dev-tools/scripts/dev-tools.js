/**
 * Development Tools - Ultra Media Element
 * Main entry point for all development tools functionality
 */

import { MediaLibrary } from './media-library.js';
import { EventMonitor } from './event-monitor.js';
import { ConfigManager } from './config-manager.js';
import { PerformanceTracker } from './performance-tracker.js';

class DevTools {
  constructor() {
    this.mediaLibrary = null;
    this.eventMonitor = null;
    this.configManager = null;
    this.performanceTracker = null;
    this.ultraMediaElement = null;
    this.currentTab = 'media-library';
    
    this.initialize();
  }

  async initialize() {
    console.log('🚀 Initializing Ultra Media Element Development Tools');
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  setup() {
    // Get ultra-media element
    this.ultraMediaElement = document.getElementById('ultra-media');
    if (!this.ultraMediaElement) {
      console.error('❌ Ultra Media Element not found');
      return;
    }

    // Initialize components
    this.configManager = new ConfigManager();
    this.mediaLibrary = new MediaLibrary(this.configManager);
    this.eventMonitor = new EventMonitor(this.ultraMediaElement, this.configManager);
    this.performanceTracker = new PerformanceTracker(this.ultraMediaElement);

    // Setup UI event listeners
    this.setupUIEventListeners();
    
    // Setup tab system
    this.setupTabSystem();
    
    // Setup quick actions
    this.setupQuickActions();
    
    // Auto-select first media sample or restore state
    setTimeout(() => {
      // MediaLibrary will handle restoration automatically after data loads
    }, 500);

    console.log('✅ Development Tools initialized successfully');
  }

  setupUIEventListeners() {
    // Tab navigation
    document.addEventListener('click', (event) => {
      if (event.target.matches('.nav-btn')) {
        const tab = event.target.dataset.tab;
        this.switchTab(tab);
      }
    });

    // Configuration controls
    this.setupConfigurationControls();
    
    // Custom URL loading
    this.setupCustomURLLoader();
  }

  setupTabSystem() {
    // Restore saved tab or default to media-library
    const savedTab = this.configManager.getConfig('ui.currentTab') || 'media-library';
    this.switchTab(savedTab);
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    // Save to config
    this.configManager.updateConfig('ui.currentTab', tabName);

    // Update navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');

    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(`${tabName}-panel`)?.classList.add('active');
    
    // Update controls panel content based on active tab
    this.updateControlsPanel(tabName);
    
    // Setup configuration controls if config tab is active
    if (tabName === 'config') {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        this.setupConfigurationControls();
        this.setupCustomURLLoader();
        this.configManager.applyInitialConfig();
      }, 50);
    }
  }

  updateControlsPanel(tabName) {
    const debugPerformanceSection = document.querySelector('.debug-performance-section');
    const configSection = document.getElementById('config-sections');
    
    // Right panel always shows debugging tools
    if (debugPerformanceSection) {
      debugPerformanceSection.style.display = 'flex';
    }
    
    // Configuration section in right panel always hidden (config goes to left sidebar)
    if (configSection) {
      configSection.style.display = 'none';
    }
  }

  setupConfigurationControls() {
    const controls = [
      'autoplay-toggle',
      'muted-toggle', 
      'controls-toggle',
      'playsinline-toggle'
    ];

    controls.forEach(controlId => {
      const control = document.getElementById(controlId);
      if (control) {
        control.addEventListener('change', (event) => {
          this.updatePlayerConfig(controlId.replace('-toggle', ''), event.target.checked);
        });
      }
    });
  }

  updatePlayerConfig(property, value) {
    if (!this.ultraMediaElement) return;

    try {
      switch (property) {
        case 'autoplay':
          this.ultraMediaElement.autoplay = value;
          break;
        case 'muted':
          this.ultraMediaElement.muted = value;
          break;
        case 'controls':
          this.ultraMediaElement.controls = value;
          break;
        case 'playsinline':
          this.ultraMediaElement.playsInline = value;
          break;
      }
      
      console.log(`🔧 Updated ${property} to ${value}`);
    } catch (error) {
      console.error(`❌ Failed to update ${property}:`, error);
    }
  }

  setupCustomURLLoader() {
    const urlInput = document.getElementById('custom-url');
    const loadButton = document.getElementById('load-custom-url');

    if (loadButton) {
      loadButton.addEventListener('click', () => {
        const url = urlInput?.value?.trim();
        if (url) {
          this.loadCustomURL(url);
        }
      });
    }

    if (urlInput) {
      urlInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
          const url = urlInput.value.trim();
          if (url) {
            this.loadCustomURL(url);
          }
        }
      });
    }
  }

  loadCustomURL(url) {
    if (!this.ultraMediaElement) return;

    try {
      // Validate URL
      new URL(url);
      
      // Clear any active sample selection
      document.querySelectorAll('.sample-item').forEach(item => {
        item.classList.remove('active');
      });

      // Load URL
      this.ultraMediaElement.src = url;
      
      // Save to config
      this.configManager.updateConfig('media.currentUrl', url);
      this.configManager.updateConfig('media.currentSample', null);
      
      // Update display
      const currentUrlDisplay = document.getElementById('current-url');
      if (currentUrlDisplay) {
        currentUrlDisplay.textContent = url;
        currentUrlDisplay.title = url;
      }

      console.log(`🔗 Loading custom URL: ${url}`);
      
      // Dispatch custom event
      document.dispatchEvent(new CustomEvent('custom-url-loaded', {
        detail: { url }
      }));
      
    } catch (error) {
      console.error('❌ Invalid URL:', error);
      this.showError('Invalid URL format');
    }
  }

  setupQuickActions() {
    // Play/Pause button
    const playPauseBtn = document.getElementById('play-pause-btn');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        this.togglePlayPause();
      });
    }

    // Reload button
    const reloadBtn = document.getElementById('reload-btn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        this.reloadMedia();
      });
    }

    // Fullscreen button
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        this.toggleFullscreen();
      });
    }
  }

  togglePlayPause() {
    if (!this.ultraMediaElement) return;

    try {
      if (this.ultraMediaElement.paused) {
        this.ultraMediaElement.play();
        console.log('▶️ Playing media');
      } else {
        this.ultraMediaElement.pause();
        console.log('⏸️ Pausing media');
      }
    } catch (error) {
      console.error('❌ Failed to toggle play/pause:', error);
      this.showError('Failed to control playback');
    }
  }

  reloadMedia() {
    if (!this.ultraMediaElement) return;

    try {
      const currentSrc = this.ultraMediaElement.src;
      if (currentSrc) {
        this.ultraMediaElement.load();
        console.log('🔄 Reloading media');
      }
    } catch (error) {
      console.error('❌ Failed to reload media:', error);
      this.showError('Failed to reload media');
    }
  }

  toggleFullscreen() {
    try {
      const mediaController = document.getElementById('media-controller');
      if (!mediaController) return;

      if (!document.fullscreenElement) {
        mediaController.requestFullscreen();
        console.log('🖥️ Entering fullscreen');
      } else {
        document.exitFullscreen();
        console.log('🔲 Exiting fullscreen');
      }
    } catch (error) {
      console.error('❌ Failed to toggle fullscreen:', error);
      this.showError('Fullscreen not supported');
    }
  }

  showError(message) {
    // Simple error display - could be enhanced with toast notifications
    console.error('🚨', message);
    
    // Update status indicator
    const statusText = document.querySelector('.status-text');
    const statusDot = document.querySelector('.status-dot');
    
    if (statusText) {
      statusText.textContent = 'Error';
      statusText.style.color = 'var(--error-color)';
    }
    
    if (statusDot) {
      statusDot.style.backgroundColor = 'var(--error-color)';
    }
    
    // Reset after 3 seconds
    setTimeout(() => {
      if (statusText) {
        statusText.textContent = 'Ready';
        statusText.style.color = '';
      }
      if (statusDot) {
        statusDot.style.backgroundColor = '';
      }
    }, 3000);
  }

  // Public API
  getMediaLibrary() {
    return this.mediaLibrary;
  }

  getEventMonitor() {
    return this.eventMonitor;
  }

  getConfigManager() {
    return this.configManager;
  }

  getPerformanceTracker() {
    return this.performanceTracker;
  }

  getCurrentTab() {
    return this.currentTab;
  }
}

// Initialize development tools when script loads
const devTools = new DevTools();

// Export for global access
window.DevTools = devTools;

export { DevTools };