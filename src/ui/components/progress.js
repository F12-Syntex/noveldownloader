/**
 * Progress Component
 * Progress bars, loading indicators, and download status
 */

import {
  colors,
  spinnerFrames,
  formatBytes,
  formatSpeed,
  formatDuration,
  clearLine,
  write
} from '../theme/index.js';

/**
 * Create a progress bar
 * @param {number} current - Current value
 * @param {number} total - Total value
 * @param {Object} options - Display options
 * @returns {string}
 */
export function progressBar(current, total, options = {}) {
  const {
    width = 30,
    showPercent = true,
    filledChar = '█',
    emptyChar = '░'
  } = options;

  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  const bar = colors.success(filledChar.repeat(filled)) + colors.muted(emptyChar.repeat(empty));

  if (showPercent) {
    return `${bar} ${colors.highlight(`${percentage}%`)}`;
  }
  return bar;
}

/**
 * Create a detailed progress display for downloads
 * @param {Object} state - Download state
 * @returns {string}
 */
export function downloadProgress(state) {
  const {
    current,
    total,
    currentItem,
    bytesDownloaded,
    speed,
    eta
  } = state;

  const lines = [];

  // Main progress bar
  lines.push(progressBar(current, total));

  // Item info
  const itemText = `[${current}/${total}]`;
  if (currentItem) {
    lines.push(colors.muted(`${itemText} ${currentItem}`));
  } else {
    lines.push(colors.muted(itemText));
  }

  // Stats line
  const stats = [];
  if (bytesDownloaded !== undefined) {
    stats.push(formatBytes(bytesDownloaded));
  }
  if (speed !== undefined) {
    stats.push(formatSpeed(speed));
  }
  if (eta !== undefined) {
    stats.push(`ETA: ${formatDuration(eta)}`);
  }
  if (stats.length > 0) {
    lines.push(colors.muted(stats.join(' | ')));
  }

  return lines.join('\n');
}

/**
 * Create a torrent progress display
 * @param {Object} state - Torrent state
 * @returns {string}
 */
export function torrentProgress(state) {
  const {
    name,
    progress,
    downloaded,
    total,
    downloadSpeed,
    uploadSpeed,
    peers,
    eta
  } = state;

  const lines = [];

  // Name
  if (name) {
    lines.push(colors.highlight(name));
  }

  // Progress bar
  const percent = Math.round((progress || 0) * 100);
  lines.push(progressBar(percent, 100));

  // Size info
  const sizeInfo = [];
  if (downloaded !== undefined && total !== undefined) {
    sizeInfo.push(`${formatBytes(downloaded)} / ${formatBytes(total)}`);
  }
  if (sizeInfo.length > 0) {
    lines.push(colors.muted(sizeInfo.join(' ')));
  }

  // Speed and peers
  const speedInfo = [];
  if (downloadSpeed !== undefined) {
    speedInfo.push(`↓ ${formatSpeed(downloadSpeed)}`);
  }
  if (uploadSpeed !== undefined) {
    speedInfo.push(`↑ ${formatSpeed(uploadSpeed)}`);
  }
  if (peers !== undefined) {
    speedInfo.push(`Peers: ${peers}`);
  }
  if (eta !== undefined && eta < Infinity) {
    speedInfo.push(`ETA: ${formatDuration(eta)}`);
  }
  if (speedInfo.length > 0) {
    lines.push(colors.muted(speedInfo.join(' | ')));
  }

  return lines.join('\n');
}

/**
 * Get spinner frame
 * @param {number} frame - Frame index
 * @returns {string}
 */
export function spinner(frame = 0) {
  return colors.primary(spinnerFrames[frame % spinnerFrames.length]);
}

/**
 * Create loading text with spinner
 * @param {string} message - Loading message
 * @param {number} frame - Spinner frame
 * @returns {string}
 */
export function loadingText(message, frame = 0) {
  return `${spinner(frame)} ${colors.muted(message)}`;
}

/**
 * Create an inline progress updater
 * Returns a function to update progress in-place
 */
export function createInlineProgress() {
  let frame = 0;

  return {
    /**
     * Update the progress display
     * @param {string} message - Message to display
     */
    update(message) {
      clearLine();
      write(loadingText(message, frame++));
    },

    /**
     * Complete the progress
     * @param {string} message - Final message
     */
    complete(message) {
      clearLine();
      console.log(message);
    },

    /**
     * Clear the progress line
     */
    clear() {
      clearLine();
    }
  };
}

/**
 * Create a multi-item progress tracker
 * @param {number} total - Total items
 * @returns {Object}
 */
export function createProgressTracker(total) {
  let completed = 0;
  let failed = 0;
  const startTime = Date.now();

  return {
    /**
     * Mark an item as completed
     */
    complete() {
      completed++;
    },

    /**
     * Mark an item as failed
     */
    fail() {
      failed++;
    },

    /**
     * Get current state
     */
    getState() {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completed / elapsed;
      const remaining = total - completed - failed;
      const eta = rate > 0 ? remaining / rate : 0;

      return {
        total,
        completed,
        failed,
        remaining,
        elapsed,
        rate,
        eta,
        percent: Math.round(((completed + failed) / total) * 100)
      };
    },

    /**
     * Get progress display
     */
    getDisplay() {
      const state = this.getState();
      const status = [];

      status.push(progressBar(state.completed + state.failed, state.total));
      status.push(colors.muted(`Completed: ${state.completed}/${state.total}`));

      if (state.failed > 0) {
        status.push(colors.error(`Failed: ${state.failed}`));
      }

      return status.join('\n');
    }
  };
}

export default {
  progressBar,
  downloadProgress,
  torrentProgress,
  spinner,
  loadingText,
  createInlineProgress,
  createProgressTracker
};
