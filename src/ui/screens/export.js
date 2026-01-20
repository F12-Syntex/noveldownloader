/**
 * Export Screen
 * Handles export flows for novels and manga
 */

import {
  sectionHeader,
  buildExportFormatChoices,
  selectMenu,
  textInput,
  confirm,
  progressBar,
  pressEnter,
  success,
  error,
  warning,
  info
} from '../components/index.js';
import {
  colors,
  menuChoice,
  backChoice,
  getContentLabel,
  truncate
} from '../theme/index.js';
import { getActiveSource } from '../../core/sources/manager.js';
import { ContentType, Capabilities, hasCapability } from '../../core/content/types.js';

/**
 * Select export format based on source capabilities
 * @returns {Promise<string|null>} Selected format or null
 */
export async function selectExportFormat() {
  const source = getActiveSource();

  if (!source) {
    console.log(error('No source selected'));
    return null;
  }

  if (source.contentType === ContentType.ANIME) {
    console.log(warning('Export is not available for anime content'));
    return null;
  }

  const contentLabel = getContentLabel(source.contentType);

  console.log('\n' + sectionHeader(`Export ${contentLabel}`));
  console.log('');

  const choices = buildExportFormatChoices(source);

  const format = await selectMenu('Select export format:', choices);

  return format;
}

/**
 * Select content to export
 * @param {Object} storage - Storage manager instance
 * @returns {Promise<Object|null>} Selected content or null
 */
export async function selectContentToExport(storage) {
  const source = getActiveSource();
  const contentLabel = getContentLabel(source?.contentType || ContentType.NOVEL, { lowercase: true });

  // Get downloaded content
  let downloads;
  try {
    downloads = await storage.listDownloads(source?.contentType);
  } catch (err) {
    console.log(error(`Failed to load downloads: ${err.message}`));
    return null;
  }

  if (!downloads || downloads.length === 0) {
    console.log(warning(`No downloaded ${contentLabel} available for export.`));
    await pressEnter();
    return null;
  }

  // Filter to only show items with chapters
  const exportable = downloads.filter(d => d.downloadedChapters > 0 || d.chapters?.length > 0);

  if (exportable.length === 0) {
    console.log(warning('No content with chapters available for export.'));
    await pressEnter();
    return null;
  }

  const choices = exportable.map((item, index) => ({
    name: `${index + 1}. ${truncate(item.title, 40)} ${colors.muted(`(${item.downloadedChapters || item.chapters?.length} chapters)`)}`,
    value: item.id
  }));
  choices.push(backChoice('Cancel'));

  const selection = await selectMenu(`Select ${contentLabel} to export:`, choices, {
    pageSize: 15
  });

  if (!selection) {
    return null;
  }

  return exportable.find(d => d.id === selection);
}

/**
 * Configure export options
 * @param {Object} content - Content to export
 * @param {string} format - Export format
 * @returns {Promise<Object|null>} Export options or null
 */
export async function configureExportOptions(content, format) {
  const source = getActiveSource();
  const isManga = source?.contentType === ContentType.MANGA;

  console.log('\n' + sectionHeader('Export Options'));
  console.log('');

  // Default filename
  const defaultFilename = sanitizeFilename(content.title);
  const filename = await textInput('Output filename (without extension):', {
    default: defaultFilename
  });

  if (!filename || !filename.trim()) {
    return null;
  }

  const options = {
    filename: filename.trim(),
    format,
    includeImages: true,
    splitVolumes: false
  };

  // Format-specific options
  if (format === 'epub' && !isManga) {
    const includeMetadata = await confirm('Include metadata (title, author, etc.)?', true);
    options.includeMetadata = includeMetadata;
  }

  if (format === 'pdf') {
    const choices = [
      menuChoice('A4', 'a4', 'Standard paper size'),
      menuChoice('Letter', 'letter', 'US Letter size'),
      menuChoice('A5', 'a5', 'Smaller book size'),
      backChoice('Cancel')
    ];

    const pageSize = await selectMenu('Page size:', choices);
    if (!pageSize) return null;

    options.pageSize = pageSize;
  }

  if (format === 'cbz' && isManga) {
    const perChapter = await confirm('Create separate CBZ per chapter?', false);
    options.splitChapters = perChapter;
  }

  return options;
}

/**
 * Show export progress
 * @param {Object} progress - Export progress data
 */
export function showExportProgress(progress) {
  const { current, total, stage } = progress;

  if (process.stdout.isTTY && process.stdout.clearLine) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }

  const bar = progressBar(current, total);
  const stageText = stage ? colors.muted(` ${stage}`) : '';

  process.stdout.write(`${bar} [${current}/${total}]${stageText}`);
}

/**
 * Execute export operation
 * @param {Object} content - Content to export
 * @param {Object} options - Export options
 * @param {Object} exporter - Export manager instance
 * @returns {Promise<Object>} Export result
 */
export async function executeExport(content, options, exporter) {
  const { format, filename } = options;

  console.log('\n' + info(`Exporting to ${format.toUpperCase()}...`));
  console.log('');

  try {
    const result = await exporter.export(content, {
      ...options,
      onProgress: showExportProgress
    });

    console.log(''); // New line after progress
    console.log(success(`Export complete!`));
    console.log(colors.muted(`\nSaved to: ${result.outputPath}`));

    return result;
  } catch (err) {
    console.log(''); // New line after progress
    console.log(error(`Export failed: ${err.message}`));
    throw err;
  }
}

/**
 * Full export flow
 * @param {Object} storage - Storage manager
 * @param {Object} exporter - Export manager
 * @returns {Promise<Object|null>} Export result or null
 */
export async function exportFlow(storage, exporter) {
  // Select format
  const format = await selectExportFormat();
  if (!format) return null;

  // Select content
  const content = await selectContentToExport(storage);
  if (!content) return null;

  // Configure options
  const options = await configureExportOptions(content, format);
  if (!options) return null;

  // Confirm
  console.log('');
  const proceed = await confirm('Start export?', true);
  if (!proceed) return null;

  // Execute
  return await executeExport(content, options, exporter);
}

/**
 * Sanitize filename for filesystem
 * @param {string} name - Original name
 * @returns {string} Sanitized name
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

export default {
  selectExportFormat,
  selectContentToExport,
  configureExportOptions,
  showExportProgress,
  executeExport,
  exportFlow
};
