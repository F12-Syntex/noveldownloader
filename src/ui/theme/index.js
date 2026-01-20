/**
 * Unified Theme System
 * Single source of truth for all UI styling, colors, and visual elements
 */

import chalk from 'chalk';
import { ContentType, ContentTypeDisplay } from '../../core/content/types.js';

// ═══════════════════════════════════════════════════════════════
// Color Theme
// ═══════════════════════════════════════════════════════════════

export const colors = {
  // Primary palette
  primary: chalk.cyan,
  secondary: chalk.blue,
  accent: chalk.magenta,

  // Semantic colors
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.cyan,

  // Text colors
  text: chalk.white,
  textBold: chalk.white.bold,
  muted: chalk.gray,
  highlight: chalk.white.bold,

  // Content type colors
  novel: chalk.cyan,
  manga: chalk.magenta,
  anime: chalk.yellow
};

// ═══════════════════════════════════════════════════════════════
// Icons and Symbols
// ═══════════════════════════════════════════════════════════════

export const icons = {
  // Content types
  novel: '📖',
  manga: '📚',
  anime: '🎬',

  // Status indicators
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  pending: '○',
  active: '●',
  loading: '◌',

  // Navigation
  back: '←',
  forward: '→',
  up: '↑',
  down: '↓',

  // Actions
  download: '⬇',
  export: '📤',
  search: '🔍',
  settings: '⚙',
  source: '🔌',
  folder: '📁',
  file: '📄',

  // List markers
  bullet: '•',
  check: '✓',
  cross: '✗',

  // Trust/quality indicators
  trusted: '★',
  remake: '✗',
  verified: '✓'
};

// ═══════════════════════════════════════════════════════════════
// Box Drawing Characters
// ═══════════════════════════════════════════════════════════════

export const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  dividerLeft: '├',
  dividerRight: '┤',
  cross: '┼',
  teeDown: '┬',
  teeUp: '┴'
};

// ═══════════════════════════════════════════════════════════════
// Spinner Frames
// ═══════════════════════════════════════════════════════════════

export const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Strip ANSI codes from string (for length calculation)
 */
export function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Get icon for content type
 */
export function getContentIcon(contentType) {
  const display = ContentTypeDisplay[contentType];
  return display ? display.icon : icons.novel;
}

/**
 * Get color function for content type
 */
export function getContentColor(contentType) {
  switch (contentType) {
    case ContentType.NOVEL: return colors.novel;
    case ContentType.MANGA: return colors.manga;
    case ContentType.ANIME: return colors.anime;
    default: return colors.primary;
  }
}

/**
 * Get label for content type
 */
export function getContentLabel(contentType, options = {}) {
  const display = ContentTypeDisplay[contentType];
  if (!display) return 'Content';

  const label = options.plural ? display.plural : display.label;
  return options.lowercase ? label.toLowerCase() : label;
}

/**
 * Get app title based on content type
 */
export function getAppTitle(contentType) {
  const label = getContentLabel(contentType).toUpperCase();
  return `${label} DOWNLOADER`;
}

/**
 * Get app subtitle
 */
export function getAppSubtitle(contentType) {
  const label = getContentLabel(contentType, { plural: true, lowercase: true });
  return `Download & export ${label} from multiple sources`;
}

// ═══════════════════════════════════════════════════════════════
// Text Formatting
// ═══════════════════════════════════════════════════════════════

/**
 * Format status indicator with icon and color
 */
export function formatStatus(status) {
  const config = {
    success: { icon: icons.success, color: colors.success },
    error: { icon: icons.error, color: colors.error },
    warning: { icon: icons.warning, color: colors.warning },
    info: { icon: icons.info, color: colors.info },
    pending: { icon: icons.pending, color: colors.muted },
    active: { icon: icons.active, color: colors.success },
    loading: { icon: icons.loading, color: colors.primary }
  };

  const cfg = config[status] || config.info;
  return cfg.color(cfg.icon);
}

/**
 * Format a key-value pair
 */
export function formatKeyValue(key, value, keyWidth = 12) {
  const paddedKey = key.padEnd(keyWidth);
  return `${colors.muted(paddedKey)} ${colors.highlight(value)}`;
}

/**
 * Format a list item
 */
export function formatListItem(text, indent = 2) {
  return ' '.repeat(indent) + colors.muted(icons.bullet) + ' ' + text;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text, maxLength = 50) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Center text within a given width
 */
export function centerText(text, width = 60) {
  const stripped = stripAnsi(text);
  const padding = Math.max(0, Math.floor((width - stripped.length) / 2));
  return ' '.repeat(padding) + text;
}

// ═══════════════════════════════════════════════════════════════
// Size/Duration Formatting
// ═══════════════════════════════════════════════════════════════

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format duration in seconds
 */
export function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format a speed value (bytes per second)
 */
export function formatSpeed(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + '/s';
}

// ═══════════════════════════════════════════════════════════════
// Message Formatting
// ═══════════════════════════════════════════════════════════════

/**
 * Format success message
 */
export function success(message) {
  return `${formatStatus('success')} ${colors.success(message)}`;
}

/**
 * Format error message
 */
export function error(message) {
  return `${formatStatus('error')} ${colors.error(message)}`;
}

/**
 * Format warning message
 */
export function warning(message) {
  return `${formatStatus('warning')} ${colors.warning(message)}`;
}

/**
 * Format info message
 */
export function info(message) {
  return `${formatStatus('info')} ${colors.info(message)}`;
}

// ═══════════════════════════════════════════════════════════════
// Capability Display
// ═══════════════════════════════════════════════════════════════

/**
 * Format capability for display
 */
export function formatCapability(capability) {
  const labels = {
    'search:text': 'Text search',
    'search:browse': 'Browse categories',
    'search:url': 'Direct URL',
    'content:text': 'Full chapters',
    'content:images': 'Image chapters',
    'content:torrent': 'Torrent download',
    'download:sequential': 'Sequential download',
    'download:torrent': 'P2P download',
    'export:epub': 'EPUB export',
    'export:pdf': 'PDF export',
    'export:docx': 'DOCX export',
    'export:txt': 'TXT export',
    'export:cbz': 'CBZ export',
    'export:html': 'HTML export'
  };
  return labels[capability] || capability;
}

/**
 * Format capabilities list for source display
 */
export function formatCapabilitiesList(capabilities) {
  const display = capabilities
    .map(cap => formatCapability(cap))
    .join(' • ');
  return colors.muted(icons.check + ' ' + display);
}

// ═══════════════════════════════════════════════════════════════
// Terminal Utilities
// ═══════════════════════════════════════════════════════════════

/**
 * Clear current line
 */
export function clearLine() {
  if (process.stdout.isTTY && process.stdout.clearLine) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }
}

/**
 * Write to stdout without newline
 */
export function write(text) {
  process.stdout.write(text);
}

/**
 * Get terminal width
 */
export function getTerminalWidth() {
  return process.stdout.columns || 80;
}

// ═══════════════════════════════════════════════════════════════
// Inquirer Prompt Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Default prompt configuration
 */
export function promptConfig(options = {}) {
  return {
    loop: false,
    pageSize: 12,
    ...options
  };
}

/**
 * Create a styled menu choice
 */
export function menuChoice(name, value, description = null) {
  if (description) {
    return {
      name: `${name} ${colors.muted(`- ${description}`)}`,
      value
    };
  }
  return { name, value };
}

/**
 * Create a back/cancel choice
 */
export function backChoice(label = 'Back') {
  return {
    name: colors.muted(`${icons.back} ${label}`),
    value: null
  };
}

// Export as default object for convenient importing
export default {
  colors,
  icons,
  box,
  spinnerFrames,
  stripAnsi,
  getContentIcon,
  getContentColor,
  getContentLabel,
  getAppTitle,
  getAppSubtitle,
  formatStatus,
  formatKeyValue,
  formatListItem,
  truncate,
  centerText,
  formatBytes,
  formatDuration,
  formatSpeed,
  success,
  error,
  warning,
  info,
  formatCapability,
  formatCapabilitiesList,
  clearLine,
  write,
  getTerminalWidth,
  promptConfig,
  menuChoice,
  backChoice
};
