/**
 * Event Monitor - Ultra Media Element Development Tools
 * Monitors and displays media events in real-time
 */

export class EventMonitor {
  constructor(mediaElement, configManager) {
    this.mediaElement = mediaElement;
    this.configManager = configManager;
    this.events = [];
    this.isMonitoring = false;
    this.isEnabled = configManager?.getConfig('devTools.eventMonitorEnabled') || false;
    this.startTime = null;
    this.listeners = new Map();
    this.maxEvents = 100; // Limit to prevent memory issues
    
    this.eventTypes = [
      // Lifecycle events
      'loadstart', 'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough',
      'durationchange', 'emptied', 'suspend', 'abort',
      
      // Playback events  
      'play', 'playing', 'pause', 'ended', 'waiting', 'seeking', 'seeked',
      
      // Progress events
      'progress', 'timeupdate', 'ratechange', 'volumechange',
      
      // Error events
      'error', 'stalled'
    ];
    
    this.initialize();
  }

  initialize() {
    this.setupEventListeners();
    this.setupUIControls();
    
    // Restore state and start monitoring if needed
    if (this.isEnabled) {
      this.startMonitoring();
    }
    this.updateUI();
  }

  setupEventListeners() {
    // Listen for player state changes
    document.addEventListener('sample-loaded', (event) => {
      this.onSampleLoaded(event.detail.sample);
    });

    document.addEventListener('custom-url-loaded', (event) => {
      this.onCustomURLLoaded(event.detail.url);
    });
  }

  setupUIControls() {
    const toggleBtn = document.getElementById('toggle-events');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.toggleMonitoring();
      });
    }

    const clearBtn = document.getElementById('clear-events');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearEvents();
      });
    }

    const exportBtn = document.getElementById('export-events');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportEvents();
      });
    }
  }

  toggleMonitoring() {
    if (this.isEnabled) {
      this.stopMonitoring();
      this.isEnabled = false;
    } else {
      this.isEnabled = true;
      this.startMonitoring();
      this.reloadMediaForFreshLogs();
    }
    
    // Save to config
    if (this.configManager) {
      this.configManager.updateConfig('devTools.eventMonitorEnabled', this.isEnabled);
    }
    
    this.updateUI();
  }

  startMonitoring() {
    if (this.isMonitoring || !this.mediaElement || !this.isEnabled) return;

    this.isMonitoring = true;
    this.startTime = performance.now();
    
    // Add event listeners for all event types
    this.eventTypes.forEach(eventType => {
      const listener = (event) => this.logEvent(eventType, event);
      this.mediaElement.addEventListener(eventType, listener);
      this.listeners.set(eventType, listener);
    });

    // Monitor player type changes
    this.setupPlayerTypeMonitoring();
    
    this.logMessage('🎯 Event monitoring started');
    console.log('🎯 Event monitoring started for ultra-media element');
  }

  stopMonitoring() {
    if (!this.isMonitoring || !this.mediaElement) return;

    this.isMonitoring = false;
    
    // Remove all event listeners
    this.listeners.forEach((listener, eventType) => {
      this.mediaElement.removeEventListener(eventType, listener);
    });
    this.listeners.clear();
    
    this.logMessage('⏹️ Event monitoring stopped');
    console.log('⏹️ Event monitoring stopped');
  }

  setupPlayerTypeMonitoring() {
    // Watch for data-type attribute changes to detect player type
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-type') {
          const playerType = this.mediaElement.dataset.type;
          this.updatePlayerTypeDisplay(playerType);
          this.logMessage(`🔄 Player type changed: ${playerType || 'native'}`);
        }
      });
    });

    observer.observe(this.mediaElement, {
      attributes: true,
      attributeFilter: ['data-type']
    });
  }

  logEvent(eventType, event) {
    if (!this.isMonitoring) return;

    const timestamp = performance.now() - this.startTime;
    const eventData = {
      type: eventType,
      timestamp: timestamp,
      target: event.target.tagName,
      data: this.extractEventData(eventType, event),
      id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    };

    this.events.push(eventData);
    
    // Keep only last maxEvents
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    this.displayEvent(eventData);
    this.updatePlayerState(eventType, event);
  }

  logMessage(message) {
    const messageData = {
      type: 'system',
      timestamp: this.startTime ? performance.now() - this.startTime : 0,
      target: 'SYSTEM',
      data: { message },
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    };

    this.events.push(messageData);
    this.displayEvent(messageData);
  }

  extractEventData(eventType, event) {
    const data = {};
    const target = event.target;

    try {
      switch (eventType) {
        case 'timeupdate':
          data.currentTime = target.currentTime?.toFixed(2);
          data.duration = target.duration?.toFixed(2);
          data.buffered = this.getBufferedRanges(target.buffered);
          break;
          
        case 'progress':
          data.buffered = this.getBufferedRanges(target.buffered);
          data.loaded = target.buffered?.length > 0 ? target.buffered.end(target.buffered.length - 1).toFixed(2) : 0;
          break;
          
        case 'durationchange':
          data.duration = target.duration?.toFixed(2);
          break;
          
        case 'volumechange':
          data.volume = target.volume?.toFixed(2);
          data.muted = target.muted;
          break;
          
        case 'ratechange':
          data.playbackRate = target.playbackRate;
          break;
          
        case 'seeking':
        case 'seeked':
          data.currentTime = target.currentTime?.toFixed(2);
          data.seeking = target.seeking;
          break;
          
        case 'loadedmetadata':
          data.duration = target.duration?.toFixed(2);
          data.videoWidth = target.videoWidth;
          data.videoHeight = target.videoHeight;
          break;
          
        case 'error':
          if (target.error) {
            data.error = {
              code: target.error.code,
              message: target.error.message
            };
          }
          break;
          
        case 'canplay':
        case 'canplaythrough':
          data.readyState = target.readyState;
          data.networkState = target.networkState;
          break;
          
        default:
          // For other events, capture basic state
          data.currentTime = target.currentTime?.toFixed(2);
          data.paused = target.paused;
          data.ended = target.ended;
          data.readyState = target.readyState;
      }
    } catch (error) {
      data.extractError = error.message;
    }

    return data;
  }

  getBufferedRanges(buffered) {
    if (!buffered) return [];
    
    const ranges = [];
    for (let i = 0; i < buffered.length; i++) {
      ranges.push({
        start: buffered.start(i).toFixed(2),
        end: buffered.end(i).toFixed(2)
      });
    }
    return ranges;
  }

  updateUI() {
    const toggleBtn = document.getElementById('toggle-events');
    const eventList = document.getElementById('event-list');
    const disabledMessage = document.getElementById('event-monitor-disabled');
    
    if (toggleBtn) {
      toggleBtn.textContent = this.isEnabled ? 'Disable' : 'Enable';
    }
    
    if (eventList && disabledMessage) {
      if (this.isEnabled) {
        eventList.style.display = 'block';
        disabledMessage.style.display = 'none';
      } else {
        eventList.style.display = 'none';
        disabledMessage.style.display = 'flex';
      }
    }
  }

  displayEvent(eventData) {
    if (!this.isEnabled) return;
    
    const eventList = document.getElementById('event-list');
    if (!eventList) return;

    const eventElement = document.createElement('div');
    eventElement.className = `event-item event-${eventData.type}`;
    eventElement.dataset.eventId = eventData.id;
    
    const timestampStr = eventData.timestamp.toFixed(0);
    const dataStr = this.formatEventData(eventData.data);
    
    eventElement.innerHTML = `
      <div class="event-header">
        <span class="event-timestamp">${timestampStr}ms</span>
        <span class="event-type">${eventData.type}</span>
        <span class="event-target">${eventData.target}</span>
      </div>
      ${dataStr ? `<div class="event-data">${dataStr}</div>` : ''}
    `;

    eventList.appendChild(eventElement);
    
    // Auto-scroll to bottom
    eventList.scrollTop = eventList.scrollHeight;
    
    // Limit DOM elements to prevent performance issues
    while (eventList.children.length > this.maxEvents) {
      eventList.removeChild(eventList.firstChild);
    }
  }

  formatEventData(data) {
    if (!data || Object.keys(data).length === 0) return '';
    
    const formatted = Object.entries(data)
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${value}`;
      })
      .join(', ');
      
    return formatted;
  }

  updatePlayerState(eventType, event) {
    const target = event.target;
    
    // Update player state display
    const playerState = document.getElementById('player-state');
    if (playerState) {
      let state = 'unknown';
      
      if (target.ended) state = 'ended';
      else if (target.paused) state = 'paused';
      else if (target.readyState < 3) state = 'loading';
      else if (target.seeking) state = 'seeking';
      else state = 'playing';
      
      playerState.textContent = state;
      playerState.className = `info-value state-${state}`;
    }

    // Update format indicator on metadata load
    if (eventType === 'loadedmetadata' || eventType === 'loadstart') {
      this.updateFormatDisplay();
    }
  }

  updateFormatDisplay() {
    const formatIndicator = document.getElementById('format-indicator');
    if (formatIndicator && this.mediaElement) {
      // Try to get format from data-type attribute or detect from src
      const dataType = this.mediaElement.dataset.type;
      let format = 'unknown';
      
      if (dataType) {
        format = dataType.replace(/\.js$/, '').toUpperCase();
      } else {
        const src = this.mediaElement.src;
        if (src.includes('.m3u8')) format = 'HLS';
        else if (src.includes('.mpd')) format = 'DASH';
        else if (src.includes('youtube.com')) format = 'YOUTUBE';
        else if (src.includes('.mp4')) format = 'MP4';
        else if (src.includes('.mp3')) format = 'MP3';
      }
      
      formatIndicator.textContent = format;
    }
  }

  updatePlayerTypeDisplay(playerType) {
    const playerTypeElement = document.getElementById('player-type');
    if (playerTypeElement) {
      const displayType = playerType || 'native';
      playerTypeElement.textContent = displayType;
      playerTypeElement.className = `info-value player-${displayType.replace(/[^a-zA-Z0-9]/g, '-')}`;
    }
  }

  clearEvents() {
    this.events = [];
    const eventList = document.getElementById('event-list');
    if (eventList) {
      eventList.innerHTML = '';
    }
    this.logMessage('🧹 Events cleared');
  }

  exportEvents() {
    const exportData = {
      timestamp: new Date().toISOString(),
      events: this.events,
      mediaElement: {
        src: this.mediaElement?.src,
        dataType: this.mediaElement?.dataset?.type
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ultra-media-events-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.logMessage('📄 Events exported');
  }

  onSampleLoaded(sample) {
    if (this.isEnabled) {
      this.clearEvents();
      this.logMessage(`📂 Sample loaded: ${sample.name} (${sample.format})`);
    }
    this.updateFormatDisplay();
  }

  onCustomURLLoaded(url) {
    if (this.isEnabled) {
      this.clearEvents();
      this.logMessage(`🔗 Custom URL loaded: ${url}`);
    }
    this.updateFormatDisplay();
  }

  // Public API
  getEvents() {
    return [...this.events];
  }

  getEventCount() {
    return this.events.length;
  }

  isActive() {
    return this.isMonitoring;
  }

  isEventMonitorEnabled() {
    return this.isEnabled;
  }

  reloadMediaForFreshLogs() {
    if (!this.mediaElement) return;

    try {
      const currentSrc = this.mediaElement.src;
      if (currentSrc) {
        // Clear events first
        this.clearEvents();
        
        // Log reload message at the start
        this.logMessage(`🔄 Media reloaded for fresh event tracking: ${currentSrc}`);
        
        // Clear the source first
        this.mediaElement.src = '';
        
        // Small delay to ensure cleanup, then reload
        setTimeout(() => {
          this.mediaElement.src = currentSrc;
        }, 100);
      }
    } catch (error) {
      console.error('❌ Failed to reload media:', error);
    }
  }
}