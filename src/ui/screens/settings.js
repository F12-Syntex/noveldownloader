/**
 * Settings Screen
 * Handles user preferences and configuration
 */

import {
  sectionHeader,
  settingsPanel,
  selectMenu,
  textInput,
  numberInput,
  confirm,
  pressEnter,
  success,
  error,
  warning,
  info
} from '../components/index.js';
import {
  colors,
  menuChoice,
  backChoice
} from '../theme/index.js';

/**
 * Show main settings menu
 * @param {Object} settingsManager - Settings manager instance
 * @returns {Promise<string|null>} Action taken or null
 */
export async function showSettings(settingsManager) {
  console.log('\n' + sectionHeader('Settings'));
  console.log('');

  const choices = [
    menuChoice('Download Settings', 'download', 'Paths, rate limits, etc.'),
    menuChoice('Anime Settings', 'anime', 'Torrent, quality preferences'),
    menuChoice('Export Settings', 'export', 'Default format, output path'),
    menuChoice('Display Settings', 'display', 'UI preferences'),
    menuChoice('View All Settings', 'view', 'See current configuration'),
    menuChoice('Reset to Defaults', 'reset', 'Restore default settings'),
    backChoice('Back to Main Menu')
  ];

  const section = await selectMenu('Select settings section:', choices);

  switch (section) {
    case 'download':
      return await showDownloadSettings(settingsManager);

    case 'anime':
      return await showAnimeSettings(settingsManager);

    case 'export':
      return await showExportSettings(settingsManager);

    case 'display':
      return await showDisplaySettings(settingsManager);

    case 'view':
      return await viewAllSettings(settingsManager);

    case 'reset':
      return await resetSettings(settingsManager);

    default:
      return null;
  }
}

/**
 * Download settings
 */
async function showDownloadSettings(settingsManager) {
  const settings = settingsManager.getAll();

  console.log('\n' + sectionHeader('Download Settings'));
  console.log('');

  const choices = [
    menuChoice('Download Path', 'downloadPath', settings.downloadPath || 'downloads'),
    menuChoice('Rate Limit', 'rateLimit', `${settings.rateLimit || 300}ms between requests`),
    menuChoice('Max Retries', 'maxRetries', `${settings.maxRetries || 3} attempts`),
    menuChoice('Concurrent Downloads', 'concurrent', `${settings.concurrentDownloads || 1}`),
    backChoice('Back')
  ];

  const setting = await selectMenu('Select setting to change:', choices);

  switch (setting) {
    case 'downloadPath':
      const newPath = await textInput('Download path:', {
        default: settings.downloadPath || 'downloads'
      });
      if (newPath) {
        await settingsManager.set('downloadPath', newPath);
        console.log(success('Download path updated'));
      }
      break;

    case 'rateLimit':
      const newRate = await numberInput('Rate limit (ms between requests):', {
        default: settings.rateLimit || 300,
        min: 100,
        max: 5000
      });
      if (newRate !== undefined) {
        await settingsManager.set('rateLimit', newRate);
        console.log(success('Rate limit updated'));
      }
      break;

    case 'maxRetries':
      const newRetries = await numberInput('Max retry attempts:', {
        default: settings.maxRetries || 3,
        min: 1,
        max: 10
      });
      if (newRetries !== undefined) {
        await settingsManager.set('maxRetries', newRetries);
        console.log(success('Max retries updated'));
      }
      break;

    case 'concurrent':
      const newConcurrent = await numberInput('Concurrent downloads:', {
        default: settings.concurrentDownloads || 1,
        min: 1,
        max: 5
      });
      if (newConcurrent !== undefined) {
        await settingsManager.set('concurrentDownloads', newConcurrent);
        console.log(success('Concurrent downloads updated'));
      }
      break;
  }

  return setting;
}

/**
 * Anime/torrent settings
 */
async function showAnimeSettings(settingsManager) {
  const settings = settingsManager.getAll();

  console.log('\n' + sectionHeader('Anime Settings'));
  console.log('');

  const choices = [
    menuChoice('Anime Download Path', 'animeDownloadPath', settings.animeDownloadPath || 'downloads/anime'),
    menuChoice('Minimum Seeders', 'minSeeders', `${settings.minSeeders || 1}`),
    menuChoice('Trusted Only', 'trustedOnly', settings.trustedOnly ? 'Yes' : 'No'),
    menuChoice('Preferred Quality', 'preferredQuality', settings.preferredQuality || '1080p'),
    backChoice('Back')
  ];

  const setting = await selectMenu('Select setting to change:', choices);

  switch (setting) {
    case 'animeDownloadPath':
      const newPath = await textInput('Anime download path:', {
        default: settings.animeDownloadPath || 'downloads/anime'
      });
      if (newPath) {
        await settingsManager.set('animeDownloadPath', newPath);
        console.log(success('Anime download path updated'));
      }
      break;

    case 'minSeeders':
      const newMin = await numberInput('Minimum seeders:', {
        default: settings.minSeeders || 1,
        min: 0,
        max: 100
      });
      if (newMin !== undefined) {
        await settingsManager.set('minSeeders', newMin);
        console.log(success('Minimum seeders updated'));
      }
      break;

    case 'trustedOnly':
      const newTrusted = await confirm('Only show trusted uploads?', settings.trustedOnly || false);
      await settingsManager.set('trustedOnly', newTrusted);
      console.log(success('Trusted only setting updated'));
      break;

    case 'preferredQuality':
      const qualityChoices = [
        menuChoice('1080p', '1080p'),
        menuChoice('720p', '720p'),
        menuChoice('480p', '480p'),
        menuChoice('4K', '2160p'),
        backChoice('Cancel')
      ];
      const quality = await selectMenu('Preferred quality:', qualityChoices);
      if (quality) {
        await settingsManager.set('preferredQuality', quality);
        console.log(success('Preferred quality updated'));
      }
      break;
  }

  return setting;
}

/**
 * Export settings
 */
async function showExportSettings(settingsManager) {
  const settings = settingsManager.getAll();

  console.log('\n' + sectionHeader('Export Settings'));
  console.log('');

  const choices = [
    menuChoice('Export Path', 'exportPath', settings.exportPath || 'exports'),
    menuChoice('Default Format', 'defaultFormat', settings.defaultExportFormat || 'epub'),
    menuChoice('Include Metadata', 'includeMetadata', settings.includeMetadata !== false ? 'Yes' : 'No'),
    backChoice('Back')
  ];

  const setting = await selectMenu('Select setting to change:', choices);

  switch (setting) {
    case 'exportPath':
      const newPath = await textInput('Export path:', {
        default: settings.exportPath || 'exports'
      });
      if (newPath) {
        await settingsManager.set('exportPath', newPath);
        console.log(success('Export path updated'));
      }
      break;

    case 'defaultFormat':
      const formatChoices = [
        menuChoice('EPUB', 'epub', 'E-book format'),
        menuChoice('PDF', 'pdf', 'Portable document'),
        menuChoice('CBZ', 'cbz', 'Comic book archive'),
        menuChoice('TXT', 'txt', 'Plain text'),
        backChoice('Cancel')
      ];
      const format = await selectMenu('Default export format:', formatChoices);
      if (format) {
        await settingsManager.set('defaultExportFormat', format);
        console.log(success('Default format updated'));
      }
      break;

    case 'includeMetadata':
      const newMeta = await confirm('Include metadata in exports?', settings.includeMetadata !== false);
      await settingsManager.set('includeMetadata', newMeta);
      console.log(success('Metadata setting updated'));
      break;
  }

  return setting;
}

/**
 * Display settings
 */
async function showDisplaySettings(settingsManager) {
  const settings = settingsManager.getAll();

  console.log('\n' + sectionHeader('Display Settings'));
  console.log('');

  const choices = [
    menuChoice('Color Theme', 'theme', settings.theme || 'default'),
    menuChoice('Show Banner', 'showBanner', settings.showBanner !== false ? 'Yes' : 'No'),
    menuChoice('Page Size', 'pageSize', `${settings.pageSize || 12} items`),
    backChoice('Back')
  ];

  const setting = await selectMenu('Select setting to change:', choices);

  switch (setting) {
    case 'theme':
      console.log(info('Theme customization coming soon'));
      await pressEnter();
      break;

    case 'showBanner':
      const newBanner = await confirm('Show application banner?', settings.showBanner !== false);
      await settingsManager.set('showBanner', newBanner);
      console.log(success('Banner setting updated'));
      break;

    case 'pageSize':
      const newSize = await numberInput('Menu page size:', {
        default: settings.pageSize || 12,
        min: 5,
        max: 30
      });
      if (newSize !== undefined) {
        await settingsManager.set('pageSize', newSize);
        console.log(success('Page size updated'));
      }
      break;
  }

  return setting;
}

/**
 * View all settings
 */
async function viewAllSettings(settingsManager) {
  const settings = settingsManager.getAll();

  console.log('\n' + sectionHeader('Current Settings'));
  console.log('');
  console.log(settingsPanel(settings));

  await pressEnter();
  return 'viewed';
}

/**
 * Reset all settings to defaults
 */
async function resetSettings(settingsManager) {
  const confirmed = await confirm('Reset all settings to defaults? This cannot be undone.', false);

  if (confirmed) {
    try {
      await settingsManager.reset();
      console.log(success('Settings reset to defaults'));
    } catch (err) {
      console.log(error(`Failed to reset: ${err.message}`));
    }
  }

  return confirmed ? 'reset' : null;
}

export default {
  showSettings
};
