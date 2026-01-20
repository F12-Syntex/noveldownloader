/**
 * Download Screen
 * Handles download flows for all content types
 */

import {
  sectionHeader,
  detailsPanel,
  chapterList,
  fileList,
  downloadSummary,
  progressBar,
  torrentProgress,
  selectMenu,
  multiSelect,
  rangeInput,
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
  formatBytes,
  formatDuration
} from '../theme/index.js';
import { getActiveSource } from '../../core/sources/manager.js';
import { getHandlerForSource } from '../../core/content/index.js';
import { ContentType } from '../../core/content/types.js';

/**
 * Show content details and confirm download
 * @param {Object} contentInfo - Content information (from search or URL fetch)
 * @returns {Promise<boolean>} True if user wants to proceed
 */
export async function showContentDetails(contentInfo) {
  const source = getActiveSource();
  const contentLabel = getContentLabel(source.contentType);

  console.log('\n' + sectionHeader(`${contentLabel} Details`));

  // Build details display
  const details = {
    'Title': contentInfo.title,
    'Author': contentInfo.author || contentInfo.info?.submitter,
    'Status': contentInfo.status,
    'Chapters': contentInfo.totalChapters || contentInfo.chapters?.length,
    'Rating': contentInfo.rating,
    'Source': contentInfo.source || source.name
  };

  // Remove undefined values
  Object.keys(details).forEach(key => {
    if (details[key] === undefined || details[key] === null) {
      delete details[key];
    }
  });

  console.log('');
  console.log(detailsPanel('', details));

  if (contentInfo.description) {
    console.log('');
    console.log(colors.muted('Description:'));
    console.log(colors.muted(contentInfo.description.substring(0, 300) + (contentInfo.description.length > 300 ? '...' : '')));
  }

  if (contentInfo.genres && contentInfo.genres.length > 0) {
    console.log('');
    console.log(colors.muted(`Genres: ${contentInfo.genres.join(', ')}`));
  }

  console.log('');

  return await confirm(`Download this ${contentLabel.toLowerCase()}?`, true);
}

/**
 * Select chapters to download
 * @param {Object} contentInfo - Content with chapters
 * @returns {Promise<number[]|null>} Array of chapter indices or null
 */
export async function selectChapters(contentInfo) {
  if (!contentInfo.chapters || contentInfo.chapters.length === 0) {
    console.log(warning('No chapters found'));
    return null;
  }

  const totalChapters = contentInfo.chapters.length;
  console.log('\n' + chapterList(contentInfo.chapters));
  console.log('');

  const choices = [
    menuChoice('Download All', 'all', `All ${totalChapters} chapters`),
    menuChoice('Select Range', 'range', 'e.g., 1-10, 15, 20-30'),
    menuChoice('Select Specific', 'select', 'Choose individual chapters'),
    backChoice('Cancel')
  ];

  const method = await selectMenu('How would you like to select chapters?', choices);

  switch (method) {
    case 'all':
      return contentInfo.chapters.map((_, i) => i);

    case 'range':
      const range = await rangeInput('Enter chapter range', 1, totalChapters);
      // Convert chapter numbers to indices (1-based to 0-based)
      return range.map(n => n - 1).filter(i => i >= 0 && i < totalChapters);

    case 'select':
      const chapterChoices = contentInfo.chapters.map((ch, i) => ({
        name: ch.title || `Chapter ${ch.number || i + 1}`,
        value: i,
        checked: false
      }));

      const selected = await multiSelect('Select chapters to download:', chapterChoices, {
        required: true
      });

      return selected;

    default:
      return null;
  }
}

/**
 * Select files from torrent
 * @param {Object} torrentInfo - Torrent info with files
 * @returns {Promise<number[]|null>} Array of file indices or null
 */
export async function selectTorrentFiles(torrentInfo) {
  if (!torrentInfo.files || torrentInfo.files.length === 0) {
    console.log(warning('No files found in torrent'));
    return null;
  }

  const handler = getHandlerForSource(getActiveSource());
  const videoFiles = handler.getVideoFiles(torrentInfo.files);

  console.log('\n' + fileList(torrentInfo.files, { showSize: true }));
  console.log('');

  const choices = [
    menuChoice('Download All Files', 'all', `${torrentInfo.files.length} files`),
  ];

  if (videoFiles.length > 0 && videoFiles.length < torrentInfo.files.length) {
    choices.push(menuChoice('Video Files Only', 'video', `${videoFiles.length} video files`));
  }

  choices.push(menuChoice('Select Specific Files', 'select', 'Choose individual files'));
  choices.push(backChoice('Cancel'));

  const method = await selectMenu('Which files would you like to download?', choices);

  switch (method) {
    case 'all':
      return torrentInfo.files.map(f => f.index);

    case 'video':
      return videoFiles.map(f => f.index);

    case 'select':
      const fileChoices = torrentInfo.files.map(f => ({
        name: `${f.name} ${colors.muted(`(${f.sizeFormatted || formatBytes(f.size)})`)}`,
        value: f.index,
        checked: f.isVideo
      }));

      const selected = await multiSelect('Select files to download:', fileChoices, {
        required: true,
        pageSize: 15
      });

      return selected;

    default:
      return null;
  }
}

/**
 * Show download progress for sequential downloads (novels/manga)
 * @param {Object} options - Progress tracking options
 */
export function createProgressDisplay(options = {}) {
  const { total } = options;
  let lastLine = '';

  return {
    update(progress) {
      const { current, chapter, status, imageProgress } = progress;

      // Clear previous line
      if (process.stdout.isTTY && process.stdout.clearLine) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
      }

      let line = progressBar(current, total) + ` [${current}/${total}]`;

      if (chapter) {
        line += ` ${colors.muted(chapter.substring(0, 30))}`;
      }

      if (imageProgress) {
        line += ` ${colors.muted(`(img ${imageProgress.current}/${imageProgress.total})`)}`;
      }

      if (status === 'error') {
        line += colors.error(' FAILED');
      }

      process.stdout.write(line);
      lastLine = line;
    },

    complete(summary) {
      if (process.stdout.isTTY && process.stdout.clearLine) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
      }
      console.log(downloadSummary(summary));
    }
  };
}

/**
 * Show torrent download progress
 * @param {Object} progressData - Torrent progress data
 */
export function showTorrentProgress(progressData) {
  if (process.stdout.isTTY && process.stdout.clearLine) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }

  const {
    progress,
    downloaded,
    downloadSpeed,
    uploadSpeed,
    peers,
    eta
  } = progressData;

  const bar = progressBar(progress, 100);
  const dl = colors.success(`↓${formatBytes(downloadSpeed || 0)}/s`);
  const ul = colors.primary(`↑${formatBytes(uploadSpeed || 0)}/s`);
  const peersStr = colors.muted(`${peers || 0} peers`);
  const etaStr = eta && eta < Infinity ? formatDuration(eta) : '--';

  process.stdout.write(`${bar} | ${dl} ${ul} | ${peersStr} | ETA: ${etaStr}`);
}

/**
 * Complete download flow for novels/manga
 * @param {Object} contentInfo - Content info with chapters
 * @param {number[]} chapterIndices - Indices to download
 * @returns {Promise<Object>} Download results
 */
export async function downloadContent(contentInfo, chapterIndices) {
  const source = getActiveSource();
  const handler = getHandlerForSource(source);
  const contentLabel = getContentLabel(source.contentType, { lowercase: true });

  console.log('\n' + sectionHeader(`Downloading ${contentLabel}`));
  console.log(info(`Downloading ${chapterIndices.length} chapters...`));
  console.log('');

  const progress = createProgressDisplay({ total: chapterIndices.length });

  const results = await handler.downloadChapters(
    contentInfo,
    chapterIndices,
    { source },
    (p) => progress.update(p)
  );

  progress.complete({
    total: results.total,
    completed: results.completed,
    failed: results.failed
  });

  return results;
}

/**
 * Complete download flow for anime torrents
 * @param {Object} torrentInfo - Torrent info
 * @param {number[]} fileIndices - File indices to download
 * @param {Object} options - Download options
 * @returns {Promise<Object>} Download results
 */
export async function downloadTorrent(torrentInfo, fileIndices, options = {}) {
  const handler = getHandlerForSource(getActiveSource());

  console.log('\n' + sectionHeader('Downloading Anime'));
  console.log(info(`Downloading ${fileIndices.length} file(s)...`));
  console.log('');

  const results = await handler.downloadFiles(torrentInfo, fileIndices, {
    downloadDir: options.downloadDir,
    onProgress: showTorrentProgress
  });

  console.log(''); // New line after progress
  console.log(success('Download complete!'));

  if (results.files) {
    console.log(colors.muted(`\nDownloaded to: ${results.files[0]?.path?.replace(/[^/\\]+$/, '')}`));
  }

  return results;
}

/**
 * Handle failed chapters retry
 * @param {Object} results - Download results
 * @param {Object} contentInfo - Original content info
 * @returns {Promise<Object>} Updated results
 */
export async function handleFailedChapters(results, contentInfo) {
  if (results.failed === 0) {
    return results;
  }

  console.log('');
  const retry = await confirm(`${results.failed} chapter(s) failed. Retry?`, true);

  if (!retry) {
    return results;
  }

  // Find failed chapter indices
  const failedIndices = results.chapters
    .map((ch, i) => ch.error ? i : null)
    .filter(i => i !== null);

  // Retry download
  const retryResults = await downloadContent(contentInfo, failedIndices);

  // Merge results
  return {
    ...results,
    completed: results.completed + retryResults.completed,
    failed: retryResults.failed,
    chapters: results.chapters.map((ch, i) => {
      if (ch.error) {
        const retryChapter = retryResults.chapters.find(r => r.url === ch.url);
        return retryChapter || ch;
      }
      return ch;
    })
  };
}

export default {
  showContentDetails,
  selectChapters,
  selectTorrentFiles,
  createProgressDisplay,
  showTorrentProgress,
  downloadContent,
  downloadTorrent,
  handleFailedChapters
};
