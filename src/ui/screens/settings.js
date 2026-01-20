/**
 * Settings Screen
 * Simple flat settings menu - no nested menus
 */

import path from 'path';
import chalk from 'chalk';
import {
  sectionHeader,
  selectMenu,
  textInput,
  numberInput,
  confirm,
  success,
  error,
  info,
  folderPicker
} from '../components/index.js';
import {
  colors,
  menuChoice,
  backChoice
} from '../theme/index.js';

/**
 * Format a path for display (truncate if too long)
 */
function formatPath(p, maxLen = 40) {
  if (!p) return colors.muted('(default)');
  if (p.length <= maxLen) return chalk.cyan(p);
  return chalk.cyan('...' + p.slice(-maxLen + 3));
}

/**
 * Show settings menu - single flat list
 */
export async function showSettings(settingsManager) {
  const settings = settingsManager.getAll();

  // Build flat menu with all settings
  const choices = [
    // Paths section
    { name: chalk.bold('── Paths ──'), value: '_sep1', disabled: '' },
    {
      name: `Base Folder        ${formatPath(settings.basePath || process.cwd())}`,
      value: 'basePath'
    },
    {
      name: `Novel/Manga Data   ${formatPath(settings.dataPath || 'data')}`,
      value: 'dataPath'
    },
    {
      name: `Exports            ${formatPath(settings.exportPath || 'exports')}`,
      value: 'exportPath'
    },
    {
      name: `Anime Downloads    ${formatPath(settings.animeDownloadPath || 'downloads/anime')}`,
      value: 'animeDownloadPath'
    },

    // Anime section
    { name: chalk.bold('── Anime ──'), value: '_sep2', disabled: '' },
    {
      name: `Quality            ${chalk.cyan(settings.preferredQuality || '1080p')}`,
      value: 'preferredQuality'
    },
    {
      name: `Min Seeders        ${chalk.cyan(settings.minSeeders ?? 1)}`,
      value: 'minSeeders'
    },
    {
      name: `Trusted Only       ${settings.trustedOnly ? chalk.green('Yes') : colors.muted('No')}`,
      value: 'trustedOnly'
    },

    // Downloads section
    { name: chalk.bold('── Downloads ──'), value: '_sep3', disabled: '' },
    {
      name: `Request Delay      ${chalk.cyan((settings.delayBetweenChapters || 400) + 'ms')}`,
      value: 'delayBetweenChapters'
    },
    {
      name: `Max Retries        ${chalk.cyan(settings.maxRetries || 3)}`,
      value: 'maxRetries'
    },

    // Actions
    { name: chalk.bold('── Actions ──'), value: '_sep4', disabled: '' },
    { name: chalk.yellow('Reset All to Defaults'), value: 'reset' },

    backChoice('Back')
  ];

  console.log('\n' + sectionHeader('Settings'));

  const choice = await selectMenu('', choices, { loop: false });

  // Handle separators
  if (!choice || choice.startsWith('_sep')) {
    return await showSettings(settingsManager);
  }

  // Handle selection
  switch (choice) {
    case 'basePath':
      await editBasePath(settingsManager, settings);
      return await showSettings(settingsManager);

    case 'dataPath':
      await editPath(settingsManager, 'dataPath', 'Novel/Manga data folder:', settings.dataPath || 'data');
      return await showSettings(settingsManager);

    case 'exportPath':
      await editPath(settingsManager, 'exportPath', 'Exports folder:', settings.exportPath || 'exports');
      return await showSettings(settingsManager);

    case 'animeDownloadPath':
      await editPath(settingsManager, 'animeDownloadPath', 'Anime downloads folder:', settings.animeDownloadPath || 'downloads/anime');
      return await showSettings(settingsManager);

    case 'preferredQuality':
      await editQuality(settingsManager, settings);
      return await showSettings(settingsManager);

    case 'minSeeders':
      const seeders = await numberInput('Minimum seeders:', {
        default: settings.minSeeders ?? 1,
        min: 0,
        max: 50
      });
      if (seeders !== undefined) {
        await settingsManager.set('minSeeders', seeders);
        console.log(success('Updated'));
      }
      return await showSettings(settingsManager);

    case 'trustedOnly':
      await settingsManager.set('trustedOnly', !settings.trustedOnly);
      console.log(success(`Trusted only: ${!settings.trustedOnly ? 'Yes' : 'No'}`));
      return await showSettings(settingsManager);

    case 'delayBetweenChapters':
      const delay = await numberInput('Delay between requests (ms):', {
        default: settings.delayBetweenChapters || 400,
        min: 100,
        max: 5000
      });
      if (delay !== undefined) {
        await settingsManager.set('delayBetweenChapters', delay);
        console.log(success('Updated'));
      }
      return await showSettings(settingsManager);

    case 'maxRetries':
      const retries = await numberInput('Max retries:', {
        default: settings.maxRetries || 3,
        min: 1,
        max: 10
      });
      if (retries !== undefined) {
        await settingsManager.set('maxRetries', retries);
        console.log(success('Updated'));
      }
      return await showSettings(settingsManager);

    case 'reset':
      const confirmed = await confirm('Reset all settings to defaults?', false);
      if (confirmed) {
        await settingsManager.reset();
        console.log(success('Settings reset'));
      }
      return await showSettings(settingsManager);

    default:
      return null;
  }
}

/**
 * Edit base path with folder picker
 */
async function editBasePath(settingsManager, settings) {
  const choices = [
    { name: 'Browse...', value: 'browse' },
    { name: 'Type path', value: 'type' },
    { name: 'Use current directory', value: 'clear' },
    backChoice('Cancel')
  ];

  const action = await selectMenu('Base folder:', choices);

  switch (action) {
    case 'browse':
      console.log(info('Opening folder picker...'));
      const selected = await folderPicker('Select Base Folder', settings.basePath || '');
      if (selected) {
        await settingsManager.set('basePath', selected);
        console.log(success(`Set to: ${selected}`));
      }
      break;

    case 'type':
      const typed = await textInput('Base path:', { default: settings.basePath || '' });
      if (typed !== undefined) {
        await settingsManager.set('basePath', typed);
        console.log(success(typed ? `Set to: ${typed}` : 'Using current directory'));
      }
      break;

    case 'clear':
      await settingsManager.set('basePath', '');
      console.log(success('Using current directory'));
      break;
  }
}

/**
 * Edit a simple path setting
 */
async function editPath(settingsManager, key, prompt, defaultVal) {
  const choices = [
    { name: 'Browse...', value: 'browse' },
    { name: 'Type path', value: 'type' },
    backChoice('Cancel')
  ];

  const action = await selectMenu(prompt, choices);

  if (action === 'browse') {
    console.log(info('Opening folder picker...'));
    const selected = await folderPicker('Select Folder');
    if (selected) {
      await settingsManager.set(key, selected);
      console.log(success(`Set to: ${selected}`));
    }
  } else if (action === 'type') {
    const typed = await textInput('Path:', { default: defaultVal });
    if (typed) {
      await settingsManager.set(key, typed);
      console.log(success(`Set to: ${typed}`));
    }
  }
}

/**
 * Edit quality preference
 */
async function editQuality(settingsManager, settings) {
  const choices = [
    { name: '4K (2160p)', value: '2160p' },
    { name: '1080p', value: '1080p' },
    { name: '720p', value: '720p' },
    { name: '480p', value: '480p' },
    backChoice('Cancel')
  ];

  const quality = await selectMenu('Preferred quality:', choices);
  if (quality) {
    await settingsManager.set('preferredQuality', quality);
    console.log(success(`Quality: ${quality}`));
  }
}

export default {
  showSettings
};
