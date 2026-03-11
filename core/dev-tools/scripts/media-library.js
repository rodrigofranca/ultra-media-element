/**
 * Media Library - Ultra Media Element Development Tools
 * Manages categorized media samples for testing
 */

export class MediaLibrary {
  constructor(configManager) {
    this.configManager = configManager;
    this.data = null;
    this.currentCategory = null;
    this.currentSamples = [];
    this.activeSample = null;
    
    this.loadData();
    this.initializeEventListeners();
  }

  async loadData() {
    try {
      const response = await fetch('./dev-tools/data/media-samples.json');
      this.data = await response.json();
      this.renderCategories();
      this.restoreState();
    } catch (error) {
      console.error('Failed to load media samples:', error);
      this.renderError('Failed to load media library data');
    }
  }

  initializeEventListeners() {
    // Format tab listeners - use event delegation with more specific targeting
    document.addEventListener('click', (event) => {
      // Handle format tab clicks (including clicks on child elements)
      const formatTab = event.target.closest('.format-tab');
      if (formatTab) {
        event.preventDefault();
        const format = formatTab.dataset.format;
        if (format && format !== this.currentCategory) {
          this.selectCategory(format);
        }
        return;
      }
      
      // Handle sample item clicks (including clicks on child elements)
      const sampleItem = event.target.closest('.sample-item');
      if (sampleItem) {
        event.preventDefault();
        const sampleId = sampleItem.dataset.sampleId;
        if (sampleId) {
          this.selectSample(sampleId);
        }
        return;
      }
    });
  }

  renderCategories() {
    const tabsContainer = document.querySelector('.format-tabs');
    if (!tabsContainer || !this.data) return;

    const formats = [
      { format: 'hls', icon: '🎬', name: 'HLS', count: this.getFormatCount('hls') },
      { format: 'dash', icon: '📺', name: 'DASH', count: this.getFormatCount('dash') },
      { format: 'mp4', icon: '🎥', name: 'MP4', count: this.getFormatCount('mp4') },
      { format: 'mp3', icon: '🎵', name: 'MP3', count: this.getFormatCount('mp3') },
      { format: 'youtube', icon: '📹', name: 'YouTube', count: this.getFormatCount('youtube') }
    ];

    tabsContainer.innerHTML = formats.map(format => `
      <button class="format-tab" data-format="${format.format}">
        <span class="tab-icon">${format.icon}</span>
        ${format.name}
      </button>
    `).join('');
    
    console.log('📚 Format tabs rendered:', formats.length);
  }

  getFormatCount(format) {
    if (!this.data || !this.data[format]) return 0;
    
    return Object.values(this.data[format]).reduce((total, typeData) => {
      return total + (Array.isArray(typeData) ? typeData.length : 0);
    }, 0);
  }

  selectCategory(format) {
    console.log('🎯 Selecting format tab:', format);
    
    // Update current category first
    this.currentCategory = format;
    
    // Save to config
    if (this.configManager) {
      this.configManager.updateConfig('media.currentFormat', format);
    }
    
    // Update UI with more robust selection for format tabs
    document.querySelectorAll('.format-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    const selectedTab = document.querySelector(`.format-tab[data-format="${format}"]`);
    if (selectedTab) {
      selectedTab.classList.add('active');
      console.log('✅ Format tab activated:', format);
    } else {
      console.warn('⚠️ Format tab not found:', format);
    }

    // Clear any existing sample selection
    document.querySelectorAll('.sample-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Render samples for this category
    this.renderSamples(format);
  }

  renderSamples(format) {
    console.log('📝 Rendering samples for format:', format);
    
    const samplesContainer = document.getElementById('media-samples');
    if (!samplesContainer) {
      console.error('❌ Samples container not found');
      return;
    }
    
    if (!this.data || !this.data[format]) {
      console.warn('⚠️ No data available for format:', format);
      samplesContainer.innerHTML = '<div class="no-samples">No data available for this format</div>';
      return;
    }

    // Collect all samples for this format
    const allSamples = [];
    Object.entries(this.data[format]).forEach(([type, samples]) => {
      if (Array.isArray(samples)) {
        samples.forEach(sample => {
          allSamples.push({ ...sample, subtype: type });
        });
      }
    });

    this.currentSamples = allSamples;
    console.log('📊 Found samples:', allSamples.length);

    if (allSamples.length === 0) {
      samplesContainer.innerHTML = '<div class="no-samples">No samples available for this format</div>';
      return;
    }

    samplesContainer.innerHTML = allSamples.map(sample => `
      <div class="sample-item" data-sample-id="${sample.id}">
        <div class="sample-header">
          <div class="sample-name">${sample.name}</div>
          <div class="sample-type">${sample.subtype}</div>
        </div>
        <div class="sample-description">${sample.description}</div>
        <div class="sample-meta">
          <span class="sample-duration">${this.formatDuration(sample.metadata.duration)}</span>
          <span class="sample-resolution">${sample.metadata.resolution || 'N/A'}</span>
        </div>
        <div class="sample-tags">
          ${sample.tags.map(tag => `<span class="sample-tag">${tag}</span>`).join('')}
        </div>
        <div class="sample-features">
          ${sample.features.map(feature => `<span class="feature-badge">${feature}</span>`).join('')}
        </div>
      </div>
    `).join('');
    
    console.log('✅ Samples rendered successfully');
  }

  selectSample(sampleId) {
    const sample = this.currentSamples.find(s => s.id === sampleId);
    if (!sample) return;

    // Update UI
    document.querySelectorAll('.sample-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`[data-sample-id="${sampleId}"]`).classList.add('active');

    this.activeSample = sample;
    
    // Save to config
    if (this.configManager) {
      this.configManager.updateConfig('media.currentSample', {
        id: sample.id,
        name: sample.name,
        url: sample.url,
        format: sample.format
      });
      this.configManager.updateConfig('media.currentUrl', sample.url);
    }
    
    this.loadSampleInPlayer(sample);
    this.updatePlayerInfo(sample);
  }

  loadSampleInPlayer(sample) {
    const ultraMedia = document.getElementById('ultra-media');
    const currentUrlDisplay = document.getElementById('current-url');
    
    if (ultraMedia) {
      // Clear any existing source first
      ultraMedia.src = '';
      
      // Small delay to ensure cleanup
      setTimeout(() => {
        ultraMedia.src = sample.url;
        
        // Update URL display
        if (currentUrlDisplay) {
          currentUrlDisplay.textContent = sample.url;
          currentUrlDisplay.title = sample.url;
        }
        
        // Dispatch custom event for other components
        document.dispatchEvent(new CustomEvent('sample-loaded', {
          detail: { sample }
        }));
      }, 100);
    }
  }

  updatePlayerInfo(sample) {
    const formatIndicator = document.getElementById('format-indicator');
    const playerType = document.getElementById('player-type');
    
    if (formatIndicator) {
      formatIndicator.textContent = sample.format.toUpperCase();
    }
    
    if (playerType) {
      // This will be updated by the player detection system
      playerType.textContent = 'Detecting...';
    }
  }

  formatDuration(seconds) {
    if (!seconds || seconds === 0) return 'Live';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  renderError(message) {
    const samplesContainer = document.getElementById('media-samples');
    if (samplesContainer) {
      samplesContainer.innerHTML = `
        <div class="error-message">
          <span class="error-icon">⚠️</span>
          <span class="error-text">${message}</span>
        </div>
      `;
    }
  }

  // Public API methods
  getSampleById(id) {
    if (!this.data) return null;
    
    for (const format in this.data) {
      for (const type in this.data[format]) {
        const sample = this.data[format][type].find(s => s.id === id);
        if (sample) return sample;
      }
    }
    return null;
  }

  getSamplesByFormat(format) {
    if (!this.data || !this.data[format]) return [];
    
    const samples = [];
    Object.values(this.data[format]).forEach(typeData => {
      if (Array.isArray(typeData)) {
        samples.push(...typeData);
      }
    });
    return samples;
  }

  getSamplesByFeatures(features) {
    if (!this.data) return [];
    
    const results = [];
    for (const format in this.data) {
      for (const type in this.data[format]) {
        const samples = this.data[format][type].filter(sample => 
          features.every(feature => sample.features.includes(feature))
        );
        results.push(...samples);
      }
    }
    return results;
  }

  searchSamples(query) {
    if (!this.data || !query) return [];
    
    const lowerQuery = query.toLowerCase();
    const results = [];
    
    for (const format in this.data) {
      for (const type in this.data[format]) {
        const samples = this.data[format][type].filter(sample => 
          sample.name.toLowerCase().includes(lowerQuery) ||
          sample.description.toLowerCase().includes(lowerQuery) ||
          sample.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
          sample.features.some(feature => feature.toLowerCase().includes(lowerQuery))
        );
        results.push(...samples);
      }
    }
    return results;
  }

  getActiveSample() {
    return this.activeSample;
  }

  getCurrentCategory() {
    return this.currentCategory;
  }

  // Restore previous state from config
  restoreState() {
    if (!this.configManager) {
      this.autoSelectFirstCategory();
      return;
    }
    
    const savedFormat = this.configManager.getConfig('media.currentFormat');
    const savedSample = this.configManager.getConfig('media.currentSample');
    const savedUrl = this.configManager.getConfig('media.currentUrl');
    
    if (savedFormat && this.data && this.data[savedFormat]) {
      // Restore format selection (without saving again)
      this.currentCategory = savedFormat;
      this.renderSamples(savedFormat);
      
      // Update UI
      document.querySelectorAll('.format-tab').forEach(tab => {
        tab.classList.remove('active');
      });
      const selectedTab = document.querySelector(`.format-tab[data-format="${savedFormat}"]`);
      if (selectedTab) {
        selectedTab.classList.add('active');
      }
      
      setTimeout(() => {
        if (savedSample && savedSample.id) {
          // Try to restore specific sample
          const sample = this.currentSamples.find(s => s.id === savedSample.id);
          if (sample) {
            this.restoreSample(sample);
            return;
          }
        }
        
        if (savedUrl) {
          // If sample not found but URL exists, load as custom URL
          this.loadCustomURL(savedUrl);
        } else {
          // Fallback to first sample
          const firstSample = this.currentSamples[0];
          if (firstSample) {
            this.selectSample(firstSample.id);
          }
        }
      }, 100);
    } else {
      // No saved state, use default behavior
      this.autoSelectFirstCategory();
    }
  }
  
  // Restore sample without triggering config save again
  restoreSample(sample) {
    // Update UI
    document.querySelectorAll('.sample-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`[data-sample-id="${sample.id}"]`)?.classList.add('active');

    this.activeSample = sample;
    this.loadSampleInPlayer(sample);
    this.updatePlayerInfo(sample);
  }

  loadCustomURL(url) {
    const ultraMedia = document.getElementById('ultra-media');
    const currentUrlDisplay = document.getElementById('current-url');
    
    if (ultraMedia) {
      ultraMedia.src = url;
      
      if (currentUrlDisplay) {
        currentUrlDisplay.textContent = url;
        currentUrlDisplay.title = url;
      }
      
      // Clear sample selection
      document.querySelectorAll('.sample-item').forEach(item => {
        item.classList.remove('active');
      });
    }
  }

  // Initialize with first category
  autoSelectFirstCategory() {
    if (this.data) {
      const firstFormat = Object.keys(this.data)[0];
      if (firstFormat) {
        this.selectCategory(firstFormat);
        
        // Auto-select first sample if available
        setTimeout(() => {
          const firstSample = this.currentSamples[0];
          if (firstSample) {
            this.selectSample(firstSample.id);
          }
        }, 100);
      }
    }
  }
}