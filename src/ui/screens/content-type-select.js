/**
 * Content Type Selection Screen
 * First screen shown to user - select what type of content to work with
 */

import inquirer from 'inquirer';
import {
  sectionHeader,
  selectMenu,
  success,
  warning,
  info
} from '../components/index.js';
import {
  colors,
  icons,
  box,
  getContentIcon,
  getContentLabel,
  promptConfig
} from '../theme/index.js';
import { ContentType } from '../../core/content/types.js';
import {
  getSources,
  getSourcesByContentType,
  setActiveSource,
  getActiveSource
} from '../../core/sources/manager.js';

/**
 * Draw the welcome banner
 */
function drawWelcomeBanner() {
  const width = 58;
  const innerWidth = width - 2;

  const lines = [
    colors.primary(`${box.topLeft}${box.horizontal.repeat(innerWidth)}${box.topRight}`),
    colors.primary(box.vertical) + ' '.repeat(innerWidth) + colors.primary(box.vertical),
    colors.primary(box.vertical) + centerText(colors.textBold('CONTENT DOWNLOADER'), innerWidth) + colors.primary(box.vertical),
    colors.primary(box.vertical) + centerText(colors.muted('Download novels, manga, and anime'), innerWidth) + colors.primary(box.vertical),
    colors.primary(box.vertical) + ' '.repeat(innerWidth) + colors.primary(box.vertical),
    colors.primary(`${box.bottomLeft}${box.horizontal.repeat(innerWidth)}${box.bottomRight}`)
  ];

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Center text helper
 */
function centerText(text, width) {
  const stripped = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  const padding = Math.max(0, Math.floor((width - stripped.length) / 2));
  return ' '.repeat(padding) + text + ' '.repeat(Math.max(0, width - stripped.length - padding));
}

/**
 * Show content type selection
 * @returns {Promise<string|null>} Selected content type or null
 */
export async function showContentTypeSelection() {
  const sources = await getSources();

  // Group sources by type and check availability
  const novelSources = sources.filter(s => s.enabled && s.contentType === ContentType.NOVEL);
  const mangaSources = sources.filter(s => s.enabled && s.contentType === ContentType.MANGA);
  const animeSources = sources.filter(s => s.enabled && s.contentType === ContentType.ANIME);

  console.log(drawWelcomeBanner());

  const choices = [];

  // Novel option
  if (novelSources.length > 0) {
    choices.push({
      name: `${icons.novel}  ${colors.novel('Novels')} ${colors.muted(`(${novelSources.length} source${novelSources.length > 1 ? 's' : ''})`)}`,
      value: ContentType.NOVEL,
      description: 'Download and read light novels and web novels'
    });
  }

  // Manga option
  if (mangaSources.length > 0) {
    choices.push({
      name: `${icons.manga}  ${colors.manga('Manga')} ${colors.muted(`(${mangaSources.length} source${mangaSources.length > 1 ? 's' : ''})`)}`,
      value: ContentType.MANGA,
      description: 'Download manga chapters with images'
    });
  }

  // Anime option
  if (animeSources.length > 0) {
    choices.push({
      name: `${icons.anime}  ${colors.anime('Anime')} ${colors.muted(`(${animeSources.length} source${animeSources.length > 1 ? 's' : ''})`)}`,
      value: ContentType.ANIME,
      description: 'Download anime via torrents'
    });
  }

  if (choices.length === 0) {
    console.log(warning('No sources available. Please add source configurations.'));
    return null;
  }

  // Add separator and exit
  choices.push(new inquirer.Separator(colors.muted('─'.repeat(40))));
  choices.push({
    name: colors.muted('Exit'),
    value: 'exit'
  });

  const { selection } = await inquirer.prompt([{
    type: 'list',
    name: 'selection',
    message: 'What would you like to download?',
    choices,
    ...promptConfig({ pageSize: 10 })
  }]);

  if (selection === 'exit') {
    return null;
  }

  return selection;
}

/**
 * After selecting content type, select or confirm the source
 * @param {string} contentType - Selected content type
 * @returns {Promise<Object|null>} Selected source or null
 */
export async function selectSourceForType(contentType) {
  const sources = await getSourcesByContentType(contentType);
  const activeSource = getActiveSource();
  const icon = getContentIcon(contentType);
  const label = getContentLabel(contentType);

  // If only one source, auto-select it
  if (sources.length === 1) {
    await setActiveSource(sources[0].id);
    console.log(success(`Using ${sources[0].name}`));
    return sources[0];
  }

  // If active source is already of this type, offer to keep it
  if (activeSource && activeSource.contentType === contentType) {
    const choices = [
      {
        name: `${colors.success(icons.active)} ${activeSource.name} ${colors.muted('(current)')}`,
        value: activeSource.id
      },
      new inquirer.Separator(colors.muted('─ Other sources ─')),
      ...sources
        .filter(s => s.id !== activeSource.id)
        .map(s => ({
          name: `${colors.muted(icons.pending)} ${s.name}`,
          value: s.id
        })),
      new inquirer.Separator(),
      {
        name: colors.muted(`${icons.back} Back`),
        value: null
      }
    ];

    const { selectedId } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedId',
      message: `Select ${label.toLowerCase()} source:`,
      choices,
      ...promptConfig()
    }]);

    if (!selectedId) return null;

    if (selectedId !== activeSource.id) {
      await setActiveSource(selectedId);
    }

    return sources.find(s => s.id === selectedId);
  }

  // Otherwise, show all sources
  const choices = sources.map(s => ({
    name: `${colors.muted(icons.pending)} ${s.name}`,
    value: s.id
  }));

  choices.push(new inquirer.Separator());
  choices.push({
    name: colors.muted(`${icons.back} Back`),
    value: null
  });

  const { selectedId } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedId',
    message: `Select ${label.toLowerCase()} source:`,
    choices,
    ...promptConfig()
  }]);

  if (!selectedId) return null;

  await setActiveSource(selectedId);
  return sources.find(s => s.id === selectedId);
}

/**
 * Complete content type and source selection flow
 * @returns {Promise<{contentType: string, source: Object}|null>}
 */
export async function contentTypeFlow() {
  const contentType = await showContentTypeSelection();

  if (!contentType) {
    return null;
  }

  const source = await selectSourceForType(contentType);

  if (!source) {
    return null;
  }

  return { contentType, source };
}

export default {
  showContentTypeSelection,
  selectSourceForType,
  contentTypeFlow
};
