/**
 * Download Screen
 * Handles download flows for all content types
 * Includes partial download support with ffmpeg segment extraction
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
  textInput,
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
import {
  checkFfmpeg,
  extractSegment,
  getRandomTimestamp,
  formatTimestamp,
  parseTimestamp,
  parseDuration
} from '../../utils/video.js';
import path from 'path';
import fs from 'fs/promises';

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
 * Select download mode for torrent files
 * @returns {Promise<Object|null>} Download mode configuration
 */
export async function selectDownloadMode() {
  const hasFfmpeg = await checkFfmpeg();

  const choices = [
    menuChoice('Full Download', 'full', 'Download complete file(s)'),
  ];

  if (hasFfmpeg) {
    choices.push(menuChoice('Quick Sample (30s)', 'sample', 'Random 30-second preview'));
    choices.push(menuChoice('Custom Segment', 'custom', 'Choose duration and timestamp'));
  } else {
    choices.push({
      name: colors.muted('Quick Sample (requires ffmpeg)'),
      value: null,
      disabled: 'Install ffmpeg to enable'
    });
    choices.push({
      name: colors.muted('Custom Segment (requires ffmpeg)'),
      value: null,
      disabled: 'Install ffmpeg to enable'
    });
  }

  choices.push(backChoice('Cancel'));

  const mode = await selectMenu('Download mode:', choices);

  if (!mode) return null;

  if (mode === 'full') {
    return { mode: 'full' };
  }

  if (mode === 'sample') {
    return {
      mode: 'sample',
      duration: 30,
      timestamp: 'random',
      keepOriginal: false
    };
  }

  if (mode === 'custom') {
    // Get duration
    console.log('');
    console.log(colors.muted('Enter duration (e.g., "30", "1:30", "2m30s")'));
    const durationInput = await textInput('Duration:');
    const duration = parseDuration(durationInput) || 30;

    // Get timestamp
    console.log('');
    console.log(colors.muted('Enter start time (e.g., "0", "5:00", "random", or leave empty for random)'));
    const timestampInput = await textInput('Start time:');
    const timestamp = timestampInput.trim().toLowerCase() === 'random' || !timestampInput.trim()
      ? 'random'
      : parseTimestamp(timestampInput);

    // Ask about keeping original
    const keepOriginal = await confirm('Keep full file after extracting segment?', false);

    return {
      mode: 'custom',
      duration,
      timestamp,
      keepOriginal
    };
  }

  return null;
}

/**
 * Select files from torrent
 * @param {Object} torrentInfo - Torrent info with files
 * @returns {Promise<Object|null>} Selection with file indices and download mode
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

  // First, select which files
  const fileChoices = [
    menuChoice('Download All Files', 'all', `${torrentInfo.files.length} files`),
  ];

  if (videoFiles.length > 0 && videoFiles.length < torrentInfo.files.length) {
    fileChoices.push(menuChoice('Video Files Only', 'video', `${videoFiles.length} video files`));
  }

  fileChoices.push(menuChoice('Select Specific Files', 'select', 'Choose individual files'));
  fileChoices.push(backChoice('Cancel'));

  const method = await selectMenu('Which files would you like to download?', fileChoices);

  let selectedIndices = null;

  switch (method) {
    case 'all':
      selectedIndices = torrentInfo.files.map(f => f.index);
      break;

    case 'video':
      selectedIndices = videoFiles.map(f => f.index);
      break;

    case 'select':
      const selectChoices = torrentInfo.files.map(f => ({
        name: `${f.name} ${colors.muted(`(${f.sizeFormatted || formatBytes(f.size)})`)}`,
        value: f.index,
        checked: f.isVideo
      }));

      selectedIndices = await multiSelect('Select files to download:', selectChoices, {
        required: true,
        pageSize: 15
      });
      break;

    default:
      return null;
  }

  if (!selectedIndices || selectedIndices.length === 0) {
    return null;
  }

  // Check if any selected files are videos - offer partial download
  const selectedFiles = selectedIndices.map(idx => torrentInfo.files[idx]);
  const hasVideoFiles = selectedFiles.some(f => f.isVideo);

  let downloadMode = { mode: 'full' };

  if (hasVideoFiles) {
    console.log('');
    downloadMode = await selectDownloadMode();
    if (!downloadMode) return null;
  }

  return {
    indices: selectedIndices,
    ...downloadMode
  };
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
 * @param {Object} selection - Selection with indices and download mode
 * @param {Object} options - Download options
 * @returns {Promise<Object>} Download results
 */
export async function downloadTorrent(torrentInfo, selection, options = {}) {
  const handler = getHandlerForSource(getActiveSource());

  // Handle old API (just indices array)
  const fileIndices = Array.isArray(selection) ? selection : selection.indices;
  const downloadMode = Array.isArray(selection) ? { mode: 'full' } : selection;

  console.log('\n' + sectionHeader('Downloading Anime'));

  if (downloadMode.mode !== 'full') {
    const modeDesc = downloadMode.mode === 'sample'
      ? 'Quick sample (30s random)'
      : `Custom segment (${downloadMode.duration}s at ${downloadMode.timestamp === 'random' ? 'random' : formatTimestamp(downloadMode.timestamp)})`;
    console.log(info(`Mode: ${modeDesc}`));
  }

  // For partial downloads, show estimated size
  if (downloadMode.mode !== 'full') {
    console.log(info(`Estimated download: ~50-150 MB for ${downloadMode.duration}s sample`));
  }

  console.log(info(`Downloading ${fileIndices.length} file(s)...`));
  console.log('');

  // Pass partial download options to the handler
  const downloadOptions = {
    downloadDir: options.downloadDir,
    onProgress: showTorrentProgress
  };

  if (downloadMode.mode !== 'full') {
    downloadOptions.partialDownload = {
      duration: downloadMode.duration,
      timestamp: downloadMode.timestamp
    };
  }

  const results = await handler.downloadFiles(torrentInfo, fileIndices, downloadOptions);

  console.log(''); // New line after progress

  // Handle partial download / segment extraction
  if (downloadMode.mode !== 'full' && results.files) {
    console.log(success('Download complete! Extracting segment...'));
    console.log('');

    const extractedFiles = [];
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.webm', '.mov'];

    for (const file of results.files) {
      const isVideo = videoExtensions.some(ext =>
        file.name.toLowerCase().endsWith(ext)
      );

      if (!isVideo) {
        extractedFiles.push(file);
        continue;
      }

      try {
        // Determine timestamp
        let startTime = downloadMode.timestamp;
        if (startTime === 'random') {
          // Estimate duration based on file size (rough: 1GB ~ 45min for 1080p)
          const estimatedDuration = Math.max(300, (file.size / (1024 * 1024 * 1024)) * 2700);
          startTime = getRandomTimestamp(estimatedDuration, downloadMode.duration);
        }

        console.log(colors.muted(`Extracting ${downloadMode.duration}s from ${file.name} at ${formatTimestamp(startTime)}...`));

        // Create output path for segment
        const ext = path.extname(file.name);
        const baseName = path.basename(file.name, ext);
        const segmentName = `${baseName}_sample_${formatTimestamp(startTime).replace(/:/g, '-')}_${downloadMode.duration}s${ext}`;
        const segmentPath = path.join(path.dirname(file.path), segmentName);

        const segmentResult = await extractSegment(file.path, segmentPath, {
          startTime,
          duration: downloadMode.duration,
          onProgress: (p) => {
            if (process.stdout.isTTY && process.stdout.clearLine) {
              process.stdout.clearLine(0);
              process.stdout.cursorTo(0);
            }
            process.stdout.write(`Extracting: ${p.progress}%`);
          }
        });

        console.log(''); // New line after progress
        console.log(success(`Extracted: ${segmentName}`));

        extractedFiles.push({
          name: segmentName,
          path: segmentPath,
          size: segmentResult.size,
          isSegment: true,
          originalFile: file.path
        });

        // Delete original if not keeping
        if (!downloadMode.keepOriginal) {
          try {
            await fs.unlink(file.path);
            console.log(colors.muted(`Removed full file: ${file.name}`));
          } catch (err) {
            console.log(warning(`Could not remove original: ${err.message}`));
          }
        }

      } catch (err) {
        console.log(error(`Failed to extract segment from ${file.name}: ${err.message}`));
        extractedFiles.push(file); // Keep original on failure
      }
    }

    results.files = extractedFiles;
    results.isPartial = true;
  } else {
    console.log(success('Download complete!'));
  }

  if (results.files && results.files.length > 0) {
    console.log(colors.muted(`\nSaved to: ${path.dirname(results.files[0].path)}`));
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
