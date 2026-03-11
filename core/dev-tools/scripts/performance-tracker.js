/**
 * Performance Tracker - Ultra Media Element Development Tools
 * Tracks and displays performance metrics like load time and buffering
 */

export class PerformanceTracker {
  constructor(mediaElement) {
    this.mediaElement = mediaElement;
    this.metrics = new Map();
    this.timings = new Map();
    this.bufferingEvents = [];
    this.isTracking = false;
    
    this.initialize();
  }

  initialize() {
    this.setupEventListeners();
    this.startTracking();
  }

  setupEventListeners() {
    // Listen for media changes
    document.addEventListener('sample-loaded', (event) => {
      this.onMediaChange(event.detail.sample.name, event.detail.sample.url);
    });

    document.addEventListener('custom-url-loaded', (event) => {
      this.onMediaChange('Custom URL', event.detail.url);
    });
  }

  startTracking() {
    if (this.isTracking || !this.mediaElement) return;

    this.isTracking = true;
    this.setupMediaEventListeners();
    console.log('📊 Performance tracking started');
  }

  setupMediaEventListeners() {
    // Load timing events
    this.mediaElement.addEventListener('loadstart', () => {
      this.onLoadStart();
    });

    this.mediaElement.addEventListener('loadedmetadata', () => {
      this.onLoadedMetadata();
    });

    this.mediaElement.addEventListener('canplay', () => {
      this.onCanPlay();
    });

    this.mediaElement.addEventListener('canplaythrough', () => {
      this.onCanPlayThrough();
    });

    // Buffering events
    this.mediaElement.addEventListener('waiting', () => {
      this.onBufferingStart();
    });

    this.mediaElement.addEventListener('playing', () => {
      this.onBufferingEnd();
    });

    this.mediaElement.addEventListener('progress', () => {
      this.onProgress();
    });

    // Error handling
    this.mediaElement.addEventListener('error', () => {
      this.onError();
    });

    this.mediaElement.addEventListener('stalled', () => {
      this.onStalled();
    });
  }

  onMediaChange(name, url) {
    console.log('🔄 Media changed, resetting performance metrics');
    this.resetMetrics();
    this.updateDisplay();
  }

  onLoadStart() {
    const timestamp = performance.now();
    this.timings.set('loadstart', timestamp);
    this.metrics.set('loadStartTime', timestamp);
    
    this.updateMetric('loadTime', 'Loading...');
    console.log('⏳ Load started');
  }

  onLoadedMetadata() {
    const timestamp = performance.now();
    this.timings.set('loadedmetadata', timestamp);
    
    const loadStart = this.timings.get('loadstart');
    if (loadStart) {
      const metadataTime = timestamp - loadStart;
      this.metrics.set('metadataLoadTime', metadataTime);
      console.log('📋 Metadata loaded in', metadataTime.toFixed(2), 'ms');
    }
  }

  onCanPlay() {
    const timestamp = performance.now();
    this.timings.set('canplay', timestamp);
    
    const loadStart = this.timings.get('loadstart');
    if (loadStart) {
      const canPlayTime = timestamp - loadStart;
      this.metrics.set('canPlayTime', canPlayTime);
      this.updateMetric('loadTime', `${canPlayTime.toFixed(0)}ms`);
      console.log('▶️ Can play in', canPlayTime.toFixed(2), 'ms');
    }
  }

  onCanPlayThrough() {
    const timestamp = performance.now();
    this.timings.set('canplaythrough', timestamp);
    
    const loadStart = this.timings.get('loadstart');
    if (loadStart) {
      const canPlayThroughTime = timestamp - loadStart;
      this.metrics.set('canPlayThroughTime', canPlayThroughTime);
      this.updateMetric('loadTime', `${canPlayThroughTime.toFixed(0)}ms (full)`);
      console.log('⚡ Can play through in', canPlayThroughTime.toFixed(2), 'ms');
    }
  }

  onBufferingStart() {
    const timestamp = performance.now();
    const bufferingEvent = {
      start: timestamp,
      end: null,
      duration: null
    };
    
    this.bufferingEvents.push(bufferingEvent);
    this.updateMetric('buffering', 'Buffering...');
    console.log('⏸️ Buffering started');
  }

  onBufferingEnd() {
    const timestamp = performance.now();
    
    // Find the most recent buffering event that hasn't ended
    const lastBufferingEvent = this.bufferingEvents
      .slice()
      .reverse()
      .find(event => event.end === null);
    
    if (lastBufferingEvent) {
      lastBufferingEvent.end = timestamp;
      lastBufferingEvent.duration = timestamp - lastBufferingEvent.start;
      
      const totalBufferingTime = this.getTotalBufferingTime();
      const bufferingCount = this.bufferingEvents.filter(e => e.end !== null).length;
      
      this.metrics.set('totalBufferingTime', totalBufferingTime);
      this.metrics.set('bufferingCount', bufferingCount);
      
      this.updateMetric('buffering', `${totalBufferingTime.toFixed(0)}ms (${bufferingCount}x)`);
      console.log('▶️ Buffering ended, duration:', lastBufferingEvent.duration.toFixed(2), 'ms');
    }
  }

  onProgress() {
    if (this.mediaElement.buffered && this.mediaElement.buffered.length > 0) {
      const bufferedEnd = this.mediaElement.buffered.end(this.mediaElement.buffered.length - 1);
      const duration = this.mediaElement.duration || 0;
      
      if (duration > 0) {
        const bufferedPercentage = (bufferedEnd / duration) * 100;
        this.metrics.set('bufferedPercentage', bufferedPercentage);
        
        // Update buffering display if not currently buffering
        if (!this.isCurrentlyBuffering()) {
          const totalBuffering = this.getTotalBufferingTime();
          const bufferingCount = this.bufferingEvents.filter(e => e.end !== null).length;
          
          if (totalBuffering > 0) {
            this.updateMetric('buffering', `${totalBuffering.toFixed(0)}ms (${bufferingCount}x)`);
          } else {
            this.updateMetric('buffering', `${bufferedPercentage.toFixed(1)}% loaded`);
          }
        }
      }
    }
  }

  onError() {
    const timestamp = performance.now();
    this.metrics.set('errorTime', timestamp);
    this.updateMetric('loadTime', 'Error');
    this.updateMetric('buffering', 'Error');
    console.error('❌ Media error occurred');
  }

  onStalled() {
    const timestamp = performance.now();
    this.metrics.set('stalledTime', timestamp);
    this.updateMetric('buffering', 'Stalled');
    console.warn('⚠️ Media stalled');
  }

  getTotalBufferingTime() {
    return this.bufferingEvents
      .filter(event => event.end !== null)
      .reduce((total, event) => total + event.duration, 0);
  }

  isCurrentlyBuffering() {
    return this.bufferingEvents.some(event => event.end === null);
  }

  updateMetric(metricName, value) {
    const metricElements = document.querySelectorAll(`[data-metric="${metricName}"] .metric-value`);
    metricElements.forEach(element => {
      element.textContent = value;
    });
  }

  updateDisplay() {
    // Update all metrics in the UI
    const loadTime = this.metrics.get('canPlayTime') || this.metrics.get('canPlayThroughTime');
    if (loadTime) {
      this.updateMetric('loadTime', `${loadTime.toFixed(0)}ms`);
    } else {
      this.updateMetric('loadTime', '-');
    }

    const totalBuffering = this.getTotalBufferingTime();
    const bufferingCount = this.bufferingEvents.filter(e => e.end !== null).length;
    
    if (totalBuffering > 0) {
      this.updateMetric('buffering', `${totalBuffering.toFixed(0)}ms (${bufferingCount}x)`);
    } else {
      this.updateMetric('buffering', '-');
    }
  }

  resetMetrics() {
    this.metrics.clear();
    this.timings.clear();
    this.bufferingEvents = [];
  }

  // Public API
  getMetrics() {
    return Object.fromEntries(this.metrics);
  }

  getTimings() {
    return Object.fromEntries(this.timings);
  }

  getBufferingEvents() {
    return [...this.bufferingEvents];
  }

  exportMetrics() {
    return {
      timestamp: new Date().toISOString(),
      mediaElement: {
        src: this.mediaElement?.src,
        duration: this.mediaElement?.duration,
        currentTime: this.mediaElement?.currentTime
      },
      metrics: this.getMetrics(),
      timings: this.getTimings(),
      bufferingEvents: this.getBufferingEvents()
    };
  }
}