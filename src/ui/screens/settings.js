/**
 * Settings Screen - Simple and functional
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import { folderPicker } from '../components/index.js';

/**
 * Show settings menu
 */
export async function showSettings(settingsManager) {
  while (true) {
    const settings = settingsManager.getAll();

    console.log('\n' + chalk.cyan.bold('═══ Settings ═══') + '\n');

    const { choice } = await inquirer.prompt([{
      type: 'list',
      name: 'choice',
      message: 'Select setting to change:',
      pageSize: 15,
      choices: [
        new inquirer.Separator(chalk.gray('─── Paths ───')),
        { name: `Base Folder       ${chalk.cyan(settings.basePath || '(current dir)')}`, value: 'basePath' },
        { name: `Data Folder       ${chalk.cyan(settings.dataPath || 'data')}`, value: 'dataPath' },
        { name: `Export Folder     ${chalk.cyan(settings.exportPath || 'exports')}`, value: 'exportPath' },
        { name: `Anime Folder      ${chalk.cyan(settings.animeDownloadPath || 'downloads/anime')}`, value: 'animeDownloadPath' },

        new inquirer.Separator(chalk.gray('─── Anime ───')),
        { name: `Quality           ${chalk.cyan(settings.preferredQuality || '1080p')}`, value: 'quality' },
        { name: `Min Seeders       ${chalk.cyan(settings.minSeeders ?? 1)}`, value: 'seeders' },
        { name: `Trusted Only      ${settings.trustedOnly ? chalk.green('Yes') : chalk.gray('No')}`, value: 'trusted' },

        new inquirer.Separator(chalk.gray('─── Downloads ───')),
        { name: `Request Delay     ${chalk.cyan((settings.delayBetweenChapters || 400) + 'ms')}`, value: 'delay' },

        new inquirer.Separator(chalk.gray('───────────────')),
        { name: chalk.yellow('Reset to Defaults'), value: 'reset' },
        { name: chalk.gray('← Back'), value: 'back' }
      ]
    }]);

    if (choice === 'back') {
      return;
    }

    // Handle each setting
    switch (choice) {
      case 'basePath': {
        const result = await pickFolder('Select base folder', settings.basePath);
        if (result !== null) {
          await settingsManager.set('basePath', result);
          console.log(chalk.green('✓ Base folder updated'));
        }
        break;
      }

      case 'dataPath': {
        const result = await editPath('Data folder:', settings.dataPath || 'data');
        if (result !== null) {
          await settingsManager.set('dataPath', result);
          console.log(chalk.green('✓ Data folder updated'));
        }
        break;
      }

      case 'exportPath': {
        const result = await editPath('Export folder:', settings.exportPath || 'exports');
        if (result !== null) {
          await settingsManager.set('exportPath', result);
          console.log(chalk.green('✓ Export folder updated'));
        }
        break;
      }

      case 'animeDownloadPath': {
        const result = await editPath('Anime folder:', settings.animeDownloadPath || 'downloads/anime');
        if (result !== null) {
          await settingsManager.set('animeDownloadPath', result);
          console.log(chalk.green('✓ Anime folder updated'));
        }
        break;
      }

      case 'quality': {
        const { quality } = await inquirer.prompt([{
          type: 'list',
          name: 'quality',
          message: 'Preferred quality:',
          choices: ['2160p (4K)', '1080p', '720p', '480p'],
          default: settings.preferredQuality || '1080p'
        }]);
        const value = quality.split(' ')[0];
        await settingsManager.set('preferredQuality', value);
        console.log(chalk.green(`✓ Quality set to ${value}`));
        break;
      }

      case 'seeders': {
        const { seeders } = await inquirer.prompt([{
          type: 'number',
          name: 'seeders',
          message: 'Minimum seeders:',
          default: settings.minSeeders ?? 1
        }]);
        await settingsManager.set('minSeeders', seeders);
        console.log(chalk.green(`✓ Min seeders set to ${seeders}`));
        break;
      }

      case 'trusted': {
        const newValue = !settings.trustedOnly;
        await settingsManager.set('trustedOnly', newValue);
        console.log(chalk.green(`✓ Trusted only: ${newValue ? 'Yes' : 'No'}`));
        break;
      }

      case 'delay': {
        const { delay } = await inquirer.prompt([{
          type: 'number',
          name: 'delay',
          message: 'Delay between requests (ms):',
          default: settings.delayBetweenChapters || 400
        }]);
        await settingsManager.set('delayBetweenChapters', delay);
        console.log(chalk.green(`✓ Delay set to ${delay}ms`));
        break;
      }

      case 'reset': {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Reset all settings to defaults?',
          default: false
        }]);
        if (confirm) {
          await settingsManager.reset();
          console.log(chalk.green('✓ Settings reset to defaults'));
        }
        break;
      }
    }
  }
}

/**
 * Pick a folder with browse or type option
 */
async function pickFolder(title, currentValue) {
  const { method } = await inquirer.prompt([{
    type: 'list',
    name: 'method',
    message: title,
    choices: [
      { name: 'Browse...', value: 'browse' },
      { name: 'Type path', value: 'type' },
      { name: 'Clear (use current directory)', value: 'clear' },
      { name: chalk.gray('Cancel'), value: 'cancel' }
    ]
  }]);

  if (method === 'cancel') return null;
  if (method === 'clear') return '';

  if (method === 'browse') {
    console.log(chalk.gray('Opening folder picker...'));
    const result = await folderPicker(title, currentValue || '');
    return result || null;
  }

  if (method === 'type') {
    const { path } = await inquirer.prompt([{
      type: 'input',
      name: 'path',
      message: 'Enter path:',
      default: currentValue || ''
    }]);
    return path;
  }

  return null;
}

/**
 * Edit a path with type option
 */
async function editPath(message, currentValue) {
  const { method } = await inquirer.prompt([{
    type: 'list',
    name: 'method',
    message: message,
    choices: [
      { name: 'Browse...', value: 'browse' },
      { name: 'Type path', value: 'type' },
      { name: chalk.gray('Cancel'), value: 'cancel' }
    ]
  }]);

  if (method === 'cancel') return null;

  if (method === 'browse') {
    console.log(chalk.gray('Opening folder picker...'));
    const result = await folderPicker('Select folder', currentValue || '');
    return result || null;
  }

  if (method === 'type') {
    const { path } = await inquirer.prompt([{
      type: 'input',
      name: 'path',
      message: 'Enter path:',
      default: currentValue
    }]);
    return path;
  }

  return null;
}

export default { showSettings };
