/**
 * Menu Component
 * Menu building utilities and capability-driven menu generation
 */

import inquirer from 'inquirer';
import {
  colors,
  icons,
  getContentIcon,
  getContentLabel,
  formatCapabilitiesList,
  promptConfig,
  menuChoice,
  backChoice
} from '../theme/index.js';
import { Capabilities, hasCapability, ContentType } from '../../core/content/types.js';

/**
 * Create a separator line for menus
 */
export function separator(text = '') {
  return new inquirer.Separator(text ? colors.muted(`─── ${text} ───`) : colors.muted('─'.repeat(40)));
}

/**
 * Build main menu choices based on active source capabilities
 * @param {Object} source - Active source configuration
 * @returns {Array}
 */
export function buildMainMenuChoices(source) {
  if (!source) {
    return [
      menuChoice('Select Source', 'sources', 'Choose a content source to begin'),
      separator(),
      menuChoice('Settings', 'settings', 'Configure application settings'),
      menuChoice('Exit', 'exit', 'Quit the application')
    ];
  }

  const choices = [];
  const contentLabel = getContentLabel(source.contentType);
  const icon = getContentIcon(source.contentType);

  // Download section
  choices.push(separator('Download'));

  if (hasCapability(source, Capabilities.SEARCH_TEXT) ||
      hasCapability(source, Capabilities.SEARCH_BROWSE) ||
      hasCapability(source, Capabilities.SEARCH_URL)) {
    choices.push(menuChoice(
      `${icon} Download New ${contentLabel}`,
      'download',
      'Search or browse for content'
    ));
  }

  choices.push(menuChoice(
    `${icons.folder} View Downloads`,
    'downloads',
    'Manage downloaded content'
  ));

  // Export section (only for non-torrent content)
  if (source.contentType !== ContentType.ANIME) {
    choices.push(separator('Export'));
    choices.push(menuChoice(
      `${icons.export} Export Content`,
      'export',
      'Convert to EPUB, PDF, etc.'
    ));
  }

  // Sources section
  choices.push(separator('Sources'));
  choices.push(menuChoice(
    `${icons.source} Manage Sources`,
    'sources',
    'Switch or configure sources'
  ));

  // System section
  choices.push(separator('System'));
  choices.push(menuChoice(
    `${icons.settings} Settings`,
    'settings',
    'Configure application'
  ));
  choices.push(menuChoice(
    'Check Dependencies',
    'dependencies',
    'Verify required tools'
  ));
  choices.push(separator());
  choices.push(menuChoice('Exit', 'exit', 'Quit the application'));

  return choices;
}

/**
 * Build download method choices based on source capabilities
 * @param {Object} source - Source configuration
 * @returns {Array}
 */
export function buildDownloadMethodChoices(source) {
  const choices = [];
  const contentLabel = getContentLabel(source.contentType, { lowercase: true });

  if (hasCapability(source, Capabilities.SEARCH_TEXT)) {
    choices.push(menuChoice(
      `${icons.search} Search`,
      'search',
      `Search for ${contentLabel} by title`
    ));
  }

  if (hasCapability(source, Capabilities.SEARCH_BROWSE)) {
    choices.push(menuChoice(
      `${icons.folder} Browse`,
      'browse',
      'Browse by genre or category'
    ));
  }

  if (hasCapability(source, Capabilities.SEARCH_URL)) {
    choices.push(menuChoice(
      'Enter URL',
      'url',
      `Enter ${contentLabel} URL directly`
    ));
  }

  choices.push(separator());
  choices.push(backChoice('Back to Main Menu'));

  return choices;
}

/**
 * Build export format choices based on source capabilities
 * @param {Object} source - Source configuration
 * @returns {Array}
 */
export function buildExportFormatChoices(source) {
  const choices = [];

  const formats = [
    { cap: Capabilities.EXPORT_EPUB, value: 'epub', label: 'EPUB', desc: 'E-book format' },
    { cap: Capabilities.EXPORT_PDF, value: 'pdf', label: 'PDF', desc: 'Portable document' },
    { cap: Capabilities.EXPORT_DOCX, value: 'docx', label: 'DOCX', desc: 'Word document' },
    { cap: Capabilities.EXPORT_TXT, value: 'txt', label: 'Plain Text', desc: 'Simple text file' },
    { cap: Capabilities.EXPORT_CBZ, value: 'cbz', label: 'CBZ', desc: 'Comic book archive' },
    { cap: Capabilities.EXPORT_HTML, value: 'html', label: 'HTML', desc: 'Web page format' }
  ];

  for (const format of formats) {
    if (hasCapability(source, format.cap)) {
      choices.push(menuChoice(format.label, format.value, format.desc));
    }
  }

  if (choices.length === 0) {
    return [{ name: colors.muted('No export formats available'), value: null, disabled: true }];
  }

  choices.push(separator());
  choices.push(backChoice());

  return choices;
}

/**
 * Build source selection menu grouped by content type
 * @param {Array} sources - All available sources
 * @param {Object} activeSource - Currently active source
 * @returns {Array}
 */
export function buildSourceSelectionChoices(sources, activeSource) {
  const choices = [];

  // Group sources by content type
  const grouped = {
    [ContentType.NOVEL]: [],
    [ContentType.MANGA]: [],
    [ContentType.ANIME]: []
  };

  for (const source of sources) {
    const type = source.contentType || ContentType.NOVEL;
    if (grouped[type]) {
      grouped[type].push(source);
    }
  }

  // Add each group
  const groupOrder = [ContentType.NOVEL, ContentType.MANGA, ContentType.ANIME];
  const groupLabels = {
    [ContentType.NOVEL]: 'Novel Sources',
    [ContentType.MANGA]: 'Manga Sources',
    [ContentType.ANIME]: 'Anime Sources'
  };

  for (const type of groupOrder) {
    const group = grouped[type];
    if (group.length === 0) continue;

    const icon = getContentIcon(type);
    choices.push(separator(`${icon} ${groupLabels[type]}`));

    for (const source of group) {
      const isActive = activeSource && activeSource.id === source.id;
      const indicator = isActive ? colors.success(icons.active) : colors.muted(icons.pending);
      const name = isActive ? colors.success(source.name) : source.name;

      const capsDisplay = source.capabilities
        ? '\n    ' + formatCapabilitiesList(source.capabilities.slice(0, 5))
        : '';

      choices.push({
        name: `${indicator} ${name}${capsDisplay}`,
        value: source.id
      });
    }
  }

  choices.push(separator());
  choices.push(backChoice('Back to Main Menu'));

  return choices;
}

/**
 * Create a selection prompt
 * @param {string} message - Prompt message
 * @param {Array} choices - Menu choices
 * @param {Object} options - Additional options
 */
export async function selectMenu(message, choices, options = {}) {
  const { data } = await inquirer.prompt([{
    type: 'list',
    name: 'data',
    message,
    choices,
    ...promptConfig(options)
  }]);
  return data;
}

/**
 * Create a checkbox selection prompt
 * @param {string} message - Prompt message
 * @param {Array} choices - Menu choices
 * @param {Object} options - Additional options
 */
export async function checkboxMenu(message, choices, options = {}) {
  const { data } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'data',
    message,
    choices,
    ...promptConfig(options)
  }]);
  return data;
}

/**
 * Create a confirmation prompt
 * @param {string} message - Prompt message
 * @param {boolean} defaultValue - Default value
 */
export async function confirm(message, defaultValue = false) {
  const { data } = await inquirer.prompt([{
    type: 'confirm',
    name: 'data',
    message,
    default: defaultValue
  }]);
  return data;
}

/**
 * Create an input prompt
 * @param {string} message - Prompt message
 * @param {Object} options - Additional options
 */
export async function input(message, options = {}) {
  const { data } = await inquirer.prompt([{
    type: 'input',
    name: 'data',
    message,
    ...options
  }]);
  return data;
}

export default {
  separator,
  buildMainMenuChoices,
  buildDownloadMethodChoices,
  buildExportFormatChoices,
  buildSourceSelectionChoices,
  selectMenu,
  checkboxMenu,
  confirm,
  input
};
