/**
 * Status Component
 * Status messages, info panels, and result displays
 */

import {
  colors,
  icons,
  box,
  formatKeyValue,
  formatBytes,
  formatStatus,
  success as successMsg,
  error as errorMsg,
  warning as warningMsg,
  info as infoMsg,
  truncate
} from '../theme/index.js';
import { sectionHeader } from './banner.js';

// Re-export message formatters
export { successMsg as success, errorMsg as error, warningMsg as warning, infoMsg as info };

/**
 * Display content details in a formatted panel
 * @param {string} title - Panel title
 * @param {Object} details - Key-value pairs to display
 */
export function detailsPanel(title, details) {
  const output = [sectionHeader(title), ''];

  for (const [key, value] of Object.entries(details)) {
    if (value !== null && value !== undefined && value !== '') {
      output.push(formatKeyValue(key, String(value)));
    }
  }

  return output.join('\n');
}

/**
 * Display search results
 * @param {Array} results - Search results
 * @param {Object} options - Display options
 */
export function searchResults(results, options = {}) {
  const { showIndex = true, maxTitleLength = 50 } = options;

  const output = [sectionHeader('Search Results'), ''];

  results.forEach((result, index) => {
    const num = showIndex ? colors.muted(`${index + 1}.`) : '';
    const title = colors.highlight(truncate(result.title, maxTitleLength));
    const author = result.author ? colors.muted(` by ${result.author}`) : '';

    output.push(`${num} ${title}${author}`);

    // Additional info
    const meta = [];
    if (result.chapters) meta.push(`${result.chapters} chapters`);
    if (result.status) meta.push(result.status);
    if (result.rating) meta.push(`★ ${result.rating}`);

    if (meta.length > 0) {
      output.push(colors.muted(`   ${meta.join(' • ')}`));
    }
  });

  return output.join('\n');
}

/**
 * Display torrent search results
 * @param {Array} results - Torrent search results
 */
export function torrentResults(results) {
  const output = [sectionHeader('Torrent Results'), ''];

  results.forEach((result, index) => {
    const trustIcon = result.trusted ? colors.success(icons.trusted) : '';
    const remakeIcon = result.remake ? colors.error(icons.remake) : '';

    const title = colors.highlight(truncate(result.title, 60));
    output.push(`${colors.muted(`${index + 1}.`)} ${title} ${trustIcon}${remakeIcon}`);

    const meta = [];
    if (result.size) meta.push(result.size);
    if (result.seeders !== undefined) meta.push(colors.success(`↑${result.seeders}`));
    if (result.leechers !== undefined) meta.push(colors.error(`↓${result.leechers}`));
    if (result.date) meta.push(result.date);

    if (meta.length > 0) {
      output.push(colors.muted(`   ${meta.join(' • ')}`));
    }
  });

  return output.join('\n');
}

/**
 * Display download summary
 * @param {Object} summary - Download summary data
 */
export function downloadSummary(summary) {
  const { total, completed, failed, skipped } = summary;

  const output = [sectionHeader('Download Complete'), ''];

  output.push(formatKeyValue('Total', String(total)));
  output.push(formatKeyValue('Completed', colors.success(String(completed))));

  if (failed > 0) {
    output.push(formatKeyValue('Failed', colors.error(String(failed))));
  }
  if (skipped > 0) {
    output.push(formatKeyValue('Skipped', colors.warning(String(skipped))));
  }

  if (summary.size) {
    output.push(formatKeyValue('Total Size', formatBytes(summary.size)));
  }
  if (summary.duration) {
    output.push(formatKeyValue('Duration', summary.duration));
  }

  return output.join('\n');
}

/**
 * Display chapter list
 * @param {Array} chapters - Chapter list
 * @param {Object} options - Display options
 */
export function chapterList(chapters, options = {}) {
  const { showStatus = false, downloaded = new Set() } = options;

  const output = [sectionHeader('Chapters'), ''];
  output.push(colors.muted(`Total: ${chapters.length} chapters`));
  output.push('');

  // Show first and last few chapters if list is long
  const maxShow = 10;
  const showAll = chapters.length <= maxShow;

  const display = (chapter, index) => {
    const num = colors.muted(`${index + 1}.`);
    const title = chapter.title || `Chapter ${chapter.number || index + 1}`;

    if (showStatus) {
      const status = downloaded.has(chapter.url || chapter.id)
        ? formatStatus('success')
        : formatStatus('pending');
      return `${num} ${status} ${title}`;
    }
    return `${num} ${title}`;
  };

  if (showAll) {
    chapters.forEach((ch, i) => output.push(display(ch, i)));
  } else {
    // Show first 5
    for (let i = 0; i < 5; i++) {
      output.push(display(chapters[i], i));
    }
    output.push(colors.muted(`   ... ${chapters.length - 10} more chapters ...`));
    // Show last 5
    for (let i = chapters.length - 5; i < chapters.length; i++) {
      output.push(display(chapters[i], i));
    }
  }

  return output.join('\n');
}

/**
 * Display file list (for torrent files)
 * @param {Array} files - File list
 * @param {Object} options - Display options
 */
export function fileList(files, options = {}) {
  const { showIndex = true, showSize = true, videoOnly = false } = options;

  const videoExtensions = ['.mkv', '.mp4', '.avi', '.webm', '.mov'];
  const displayFiles = videoOnly
    ? files.filter(f => videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext)))
    : files;

  const output = [sectionHeader('Files'), ''];
  output.push(colors.muted(`Total: ${displayFiles.length} files`));
  output.push('');

  displayFiles.forEach((file, index) => {
    const num = showIndex ? colors.muted(`${index + 1}.`) : '';
    const name = truncate(file.name, 50);
    const size = showSize && file.size ? colors.muted(`(${formatBytes(file.size)})`) : '';
    const isVideo = videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    const videoIcon = isVideo ? colors.success(icons.file + ' ') : '';

    output.push(`${num} ${videoIcon}${name} ${size}`);
  });

  return output.join('\n');
}

/**
 * Display error with details
 * @param {string} message - Error message
 * @param {string} details - Additional details
 */
export function errorDetails(message, details = null) {
  const output = [errorMsg(message)];

  if (details) {
    output.push(colors.muted(`   ${details}`));
  }

  return output.join('\n');
}

/**
 * Display a list of items with status
 * @param {string} title - Section title
 * @param {Array} items - Items to display
 */
export function statusList(title, items) {
  const output = [sectionHeader(title), ''];

  for (const item of items) {
    const status = formatStatus(item.status || 'info');
    const name = item.name || item.title;
    const desc = item.description ? colors.muted(` - ${item.description}`) : '';

    output.push(`${status} ${name}${desc}`);
  }

  return output.join('\n');
}

/**
 * Display source info
 * @param {Object} source - Source configuration
 */
export function sourceInfo(source) {
  if (!source) {
    return warningMsg('No source selected');
  }

  const output = [sectionHeader('Source Info'), ''];

  output.push(formatKeyValue('Name', source.name));
  output.push(formatKeyValue('ID', source.id));
  output.push(formatKeyValue('Type', source.contentType || 'novel'));
  output.push(formatKeyValue('URL', source.baseUrl));

  if (source.version) {
    output.push(formatKeyValue('Version', source.version));
  }

  if (source.capabilities && source.capabilities.length > 0) {
    output.push('');
    output.push(colors.muted('Capabilities:'));
    for (const cap of source.capabilities) {
      output.push(colors.muted(`  ${icons.check} ${cap}`));
    }
  }

  return output.join('\n');
}

/**
 * Display settings panel
 * @param {Object} settings - Settings object
 */
export function settingsPanel(settings) {
  const output = [sectionHeader('Settings'), ''];

  for (const [key, value] of Object.entries(settings)) {
    let displayValue;
    if (typeof value === 'boolean') {
      displayValue = value ? colors.success('Enabled') : colors.muted('Disabled');
    } else if (typeof value === 'object') {
      displayValue = JSON.stringify(value);
    } else {
      displayValue = String(value);
    }

    output.push(formatKeyValue(key, displayValue, 20));
  }

  return output.join('\n');
}

export default {
  success: successMsg,
  error: errorMsg,
  warning: warningMsg,
  info: infoMsg,
  detailsPanel,
  searchResults,
  torrentResults,
  downloadSummary,
  chapterList,
  fileList,
  errorDetails,
  statusList,
  sourceInfo,
  settingsPanel
};
