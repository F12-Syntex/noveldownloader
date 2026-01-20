/**
 * Application Orchestrator
 * Main application controller that coordinates all modules
 */

import { log } from './logger.js';
import { initializeHandlers, getHandlerForSource } from './core/content/index.js';
import {
  initialize as initSourceManager,
  getActiveSource,
  setActiveSource,
  getSources
} from './core/sources/manager.js';
import { ContentType } from './core/content/types.js';

// UI Screens
import {
  showMainMenu,
  showContentTypeSelection,
  selectSourceForType,
  contentTypeFlow,
  showSourceManagement,
  searchFlow,
  showContentDetails,
  selectChapters,
  selectTorrentFiles,
  downloadContent,
  downloadTorrent,
  handleFailedChapters,
  showDownloadsList,
  showDownloadManagement,
  exportFlow,
  showSettings
} from './ui/screens/index.js';
import { pressEnter, success, error, warning, info } from './ui/components/index.js';
import { colors } from './ui/theme/index.js';

// External modules (existing)
import * as storage from './storage.js';
import * as exporter from './exporter.js';
import {
  loadSettings,
  saveSettings,
  getSettings,
  getSetting,
  setSetting,
  resolvePath
} from './settings.js';
import { checkAllDependencies, displayDependencyStatus } from './dependencies.js';

// Create settings manager interface expected by UI screens
const settingsManager = {
  getAll: getSettings,
  get: getSetting,
  set: setSetting,
  async reset() {
    const DEFAULT_SETTINGS = {
      detailedLogs: false,
      delayBetweenChapters: 400,
      basePath: '',
      downloadPath: 'downloads',
      dataPath: 'data',
      exportPath: 'exports',
      tempPath: 'temp',
      animeDownloadPath: 'downloads/anime',
      minSeeders: 1,
      preferredQuality: '1080p',
      trustedOnly: false
    };
    await saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
};

/**
 * Application class
 */
class App {
  constructor() {
    this.running = false;
    this.initialized = false;
  }

  /**
   * Initialize the application
   */
  async initialize() {
    if (this.initialized) return;

    log.info('Initializing application...');

    try {
      // Initialize core systems
      await initSourceManager();
      await initializeHandlers();

      // Load settings
      await loadSettings();

      this.initialized = true;
      log.info('Application initialized');
    } catch (err) {
      log.error('Failed to initialize application', { error: err.message });
      throw err;
    }
  }

  /**
   * Run the main application loop
   */
  async run() {
    await this.initialize();
    this.running = true;

    // First, let user select content type
    const result = await this.showContentTypeSelection();
    if (!result) {
      // User chose to exit
      this.running = false;
      await this.shutdown();
      return;
    }

    // Main application loop
    while (this.running) {
      try {
        const action = await showMainMenu();
        await this.handleAction(action);
      } catch (err) {
        if (err.message?.includes('User force closed')) {
          this.running = false;
        } else {
          log.error('Error in main loop', { error: err.message });
          console.log(error(`An error occurred: ${err.message}`));
          await pressEnter();
        }
      }
    }

    await this.shutdown();
  }

  /**
   * Handle main menu action
   */
  async handleAction(action) {
    switch (action) {
      case 'download':
        await this.handleDownload();
        break;

      case 'downloads':
        await this.handleViewDownloads();
        break;

      case 'export':
        await this.handleExport();
        break;

      case 'switch-type':
        await this.handleSwitchContentType();
        break;

      case 'sources':
        await this.handleSourceSelection();
        break;

      case 'settings':
        await this.handleSettings();
        break;

      case 'dependencies':
        await this.handleDependencies();
        break;

      case 'exit':
        this.running = false;
        break;

      default:
        log.warn(`Unknown action: ${action}`);
    }
  }

  /**
   * Handle download flow
   */
  async handleDownload() {
    const source = getActiveSource();
    if (!source) {
      console.log(error('No source selected'));
      return;
    }

    // Run search/browse flow to get content
    const selected = await searchFlow();
    if (!selected) return;

    const handler = getHandlerForSource(source);
    if (!handler) {
      console.log(error('No handler available for this source type'));
      return;
    }

    // Handle different content types
    if (source.contentType === ContentType.ANIME) {
      await this.handleAnimeDownload(selected, handler);
    } else {
      await this.handleContentDownload(selected, handler, source);
    }
  }

  /**
   * Handle novel/manga download
   */
  async handleContentDownload(selected, handler, source) {
    // If selected item doesn't have chapters, fetch details
    let contentInfo = selected;
    if (!contentInfo.chapters) {
      console.log(colors.muted('\nFetching details...'));
      try {
        contentInfo = await handler.getDetails(selected.url, source);
      } catch (err) {
        console.log(error(`Failed to fetch details: ${err.message}`));
        return;
      }
    }

    // Show details and confirm
    const proceed = await showContentDetails(contentInfo);
    if (!proceed) return;

    // Select chapters
    const chapterIndices = await selectChapters(contentInfo);
    if (!chapterIndices || chapterIndices.length === 0) return;

    // Download
    let results = await downloadContent(contentInfo, chapterIndices);

    // Save to storage
    try {
      await storage.saveNovel(contentInfo, results.chapters);
      console.log(success('Saved to library'));
    } catch (err) {
      console.log(warning(`Could not save to library: ${err.message}`));
    }

    // Handle failures
    if (results.failed > 0) {
      results = await handleFailedChapters(results, contentInfo);
    }

    await pressEnter();
  }

  /**
   * Handle anime/torrent download
   */
  async handleAnimeDownload(selected, handler) {
    // Get torrent files if we have a magnet link
    let torrentInfo;
    console.log(colors.muted('\nFetching torrent metadata...'));

    try {
      if (selected.magnetLink) {
        torrentInfo = await handler.getTorrentFiles(selected.magnetLink);
      } else {
        // Need to get details first to get magnet link
        const details = await handler.getDetails(selected.id);
        if (!details.magnetLink) {
          console.log(error('No magnet link available'));
          return;
        }
        torrentInfo = await handler.getTorrentFiles(details.magnetLink);
      }
    } catch (err) {
      console.log(error(`Failed to fetch torrent info: ${err.message}`));
      return;
    }

    console.log(success(`Found ${torrentInfo.files.length} files (${torrentInfo.totalSizeFormatted})`));

    // Select files and download mode
    const selection = await selectTorrentFiles(torrentInfo);
    if (!selection || !selection.indices || selection.indices.length === 0) {
      // Clean up torrent if user cancels
      handler.removeTorrent(torrentInfo.infoHash);
      return;
    }

    // Download
    const downloadPath = resolvePath(getSetting('animeDownloadPath') || 'downloads/anime');
    try {
      await downloadTorrent(torrentInfo, selection, { downloadDir: downloadPath });
    } catch (err) {
      console.log(error(`Download failed: ${err.message}`));
    }

    // Clean up
    handler.removeTorrent(torrentInfo.infoHash);
    await pressEnter();
  }

  /**
   * Handle view downloads
   */
  async handleViewDownloads() {
    const selected = await showDownloadsList(storage);
    if (!selected) return;

    const action = await showDownloadManagement(selected, storage);

    if (action === 'export') {
      await this.handleExportItem(selected);
    } else if (action?.action === 'continue') {
      // Continue download
      const source = getActiveSource();
      const handler = getHandlerForSource(source);

      const indices = action.missingChapters.map((ch, i) => {
        return selected.chapters.findIndex(c => c.url === ch.url);
      }).filter(i => i >= 0);

      if (indices.length > 0) {
        await downloadContent(selected, indices);
        await pressEnter();
      }
    }
  }

  /**
   * Handle export flow
   */
  async handleExport() {
    await exportFlow(storage, exporter);
    await pressEnter();
  }

  /**
   * Handle export for specific item
   */
  async handleExportItem(item) {
    const { selectExportFormat, configureExportOptions, executeExport } = await import('./ui/screens/export.js');

    const format = await selectExportFormat();
    if (!format) return;

    const options = await configureExportOptions(item, format);
    if (!options) return;

    try {
      await executeExport(item, options, exporter);
    } catch (err) {
      // Error already logged
    }

    await pressEnter();
  }

  /**
   * Handle source selection
   */
  async handleSourceSelection() {
    await showSourceManagement();
  }

  /**
   * Handle settings
   */
  async handleSettings() {
    await showSettings(settingsManager);
  }

  /**
   * Handle dependencies check
   */
  async handleDependencies() {
    console.log(colors.muted('\nChecking dependencies...'));
    const deps = await checkAllDependencies();
    displayDependencyStatus(deps);
    await pressEnter();
  }

  /**
   * Show content type selection and set up source
   * @returns {Promise<Object|null>} Selected content type and source, or null
   */
  async showContentTypeSelection() {
    const result = await contentTypeFlow();
    return result;
  }

  /**
   * Handle switching content type from main menu
   */
  async handleSwitchContentType() {
    const result = await contentTypeFlow();
    if (!result) {
      // User cancelled, stay in current context
      return;
    }
    // Content type and source have been updated by contentTypeFlow
    console.log(success(`Switched to ${result.source.name}`));
  }

  /**
   * Shutdown the application
   */
  async shutdown() {
    log.info('Shutting down...');

    // Clean up anime handler (torrent client)
    try {
      const { AnimeHandler } = await import('./core/content/handlers/anime-handler.js');
      const handler = new AnimeHandler();
      handler.cleanup();
    } catch (err) {
      // Ignore cleanup errors
    }

    console.log(colors.muted('\nGoodbye!'));
    process.exit(0);
  }
}

// Export singleton instance
export const app = new App();

// Export run function for entry point
export async function run() {
  return app.run();
}

export default app;
