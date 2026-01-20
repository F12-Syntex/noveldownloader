/**
 * Downloads List Screen
 * Displays downloaded content and allows management
 */

import {
  sectionHeader,
  detailsPanel,
  statusList,
  selectMenu,
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
  backChoice,
  getContentLabel,
  getContentIcon,
  truncate,
  formatBytes
} from '../theme/index.js';
import { getActiveSource } from '../../core/sources/manager.js';
import { ContentType } from '../../core/content/types.js';

// Note: This will integrate with a storage module
// For now, we'll define the interface

/**
 * Show list of downloaded content
 * @param {Object} storage - Storage manager instance
 * @returns {Promise<Object|null>} Selected content or null
 */
export async function showDownloadsList(storage) {
  const source = getActiveSource();
  const contentLabel = getContentLabel(source?.contentType || ContentType.NOVEL);
  const icon = getContentIcon(source?.contentType || ContentType.NOVEL);

  console.log('\n' + sectionHeader(`${icon} Downloaded ${contentLabel}`));
  console.log('');

  // Get downloaded content from storage
  let downloads;
  try {
    downloads = await storage.getAllDownloads();
  } catch (err) {
    console.log(error(`Failed to load downloads: ${err.message}`));
    return null;
  }

  if (!downloads || downloads.length === 0) {
    console.log(warning(`No downloaded ${contentLabel.toLowerCase()} found.`));
    await pressEnter();
    return null;
  }

  // Build choice list
  const choices = downloads.map((item, index) => {
    const chaptersInfo = item.downloadedChapters
      ? `${item.downloadedChapters}/${item.totalChapters} chapters`
      : `${item.totalChapters} chapters`;

    return menuChoice(
      `${index + 1}. ${truncate(item.title, 40)}`,
      item.id,
      chaptersInfo
    );
  });

  choices.push(backChoice('Back to Main Menu'));

  const selection = await selectMenu(`Select ${contentLabel.toLowerCase()}:`, choices, {
    pageSize: 15
  });

  if (!selection) {
    return null;
  }

  return downloads.find(d => d.id === selection);
}

/**
 * Show management options for a downloaded item
 * @param {Object} item - Downloaded content item
 * @param {Object} storage - Storage manager instance
 * @returns {Promise<string|null>} Action taken or null
 */
export async function showDownloadManagement(item, storage) {
  const source = getActiveSource();
  const contentLabel = getContentLabel(source?.contentType || ContentType.NOVEL, { lowercase: true });

  console.log('\n' + sectionHeader(item.title));
  console.log('');

  // Show details
  const details = {
    'Title': item.title,
    'Author': item.author,
    'Chapters': `${item.downloadedChapters || item.chapters?.length}/${item.totalChapters}`,
    'Source': item.source,
    'Downloaded': new Date(item.downloadedAt).toLocaleDateString()
  };

  console.log(detailsPanel('Details', details));
  console.log('');

  const choices = [
    menuChoice('Continue Downloading', 'continue', 'Download missing chapters'),
    menuChoice('Export', 'export', 'Export to EPUB, PDF, etc.'),
    menuChoice('View Chapters', 'view', 'See chapter list'),
    menuChoice('Delete', 'delete', `Remove this ${contentLabel}`),
    backChoice('Back')
  ];

  // Anime doesn't support export
  if (source?.contentType === ContentType.ANIME) {
    choices.splice(1, 1); // Remove export option
  }

  const action = await selectMenu('What would you like to do?', choices);

  switch (action) {
    case 'continue':
      return await handleContinueDownload(item, storage);

    case 'export':
      return 'export'; // Return to let caller handle export flow

    case 'view':
      return await showChapterDetails(item);

    case 'delete':
      return await handleDelete(item, storage);

    default:
      return null;
  }
}

/**
 * Handle continue download for incomplete items
 */
async function handleContinueDownload(item, storage) {
  if (!item.chapters) {
    console.log(warning('Chapter information not available'));
    return null;
  }

  const downloaded = new Set(item.downloadedChapterUrls || []);
  const missing = item.chapters.filter(ch => !downloaded.has(ch.url));

  if (missing.length === 0) {
    console.log(success('All chapters are already downloaded'));
    return null;
  }

  console.log(info(`${missing.length} chapter(s) remaining`));

  const proceed = await confirm('Download missing chapters?', true);

  if (proceed) {
    return {
      action: 'continue',
      missingChapters: missing
    };
  }

  return null;
}

/**
 * Show chapter list for an item
 */
async function showChapterDetails(item) {
  if (!item.chapters || item.chapters.length === 0) {
    console.log(warning('No chapter information available'));
    await pressEnter();
    return null;
  }

  const downloaded = new Set(item.downloadedChapterUrls || []);

  const items = item.chapters.map(ch => ({
    name: ch.title || `Chapter ${ch.number}`,
    status: downloaded.has(ch.url) ? 'success' : 'pending',
    description: downloaded.has(ch.url) ? 'Downloaded' : 'Not downloaded'
  }));

  console.log('\n' + statusList('Chapters', items.slice(0, 20)));

  if (items.length > 20) {
    console.log(colors.muted(`\n... and ${items.length - 20} more chapters`));
  }

  await pressEnter();
  return null;
}

/**
 * Handle delete confirmation and execution
 */
async function handleDelete(item, storage) {
  const confirmed = await confirm(
    `Are you sure you want to delete "${item.title}"? This cannot be undone.`,
    false
  );

  if (!confirmed) {
    return null;
  }

  try {
    await storage.deleteDownload(item.id);
    console.log(success(`Deleted "${item.title}"`));
    return 'deleted';
  } catch (err) {
    console.log(error(`Failed to delete: ${err.message}`));
    return null;
  }
}

/**
 * Show download statistics
 * @param {Object} storage - Storage manager instance
 */
export async function showDownloadStats(storage) {
  console.log('\n' + sectionHeader('Download Statistics'));
  console.log('');

  try {
    const stats = await storage.getStats();

    console.log(detailsPanel('', {
      'Total Downloads': stats.totalDownloads,
      'Novels': stats.novels,
      'Manga': stats.manga,
      'Anime': stats.anime,
      'Total Chapters': stats.totalChapters,
      'Storage Used': formatBytes(stats.storageUsed)
    }));
  } catch (err) {
    console.log(error(`Failed to load stats: ${err.message}`));
  }

  await pressEnter();
}

export default {
  showDownloadsList,
  showDownloadManagement,
  showDownloadStats
};
