/**
 * UI Utilities Module
 * Provides consistent styling and interactive elements for the CLI
 */

import chalk from 'chalk';
import { getActiveSource } from './sourceManager.js';
import { isMangaSource } from './scraper.js';

// Theme colors
export const theme = {
    primary: chalk.cyan,
    secondary: chalk.blue,
    success: chalk.green,
    warning: chalk.yellow,
    error: chalk.red,
    muted: chalk.gray,
    highlight: chalk.white.bold,
    accent: chalk.magenta,
};

// Box drawing characters
const box = {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    divider: '├',
    dividerEnd: '┤',
};

/**
 * Get content label based on active source
 */
export function getContentLabel(capitalize = false) {
    const isManga = isMangaSource();
    const label = isManga ? 'manga' : 'novel';
    return capitalize ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/**
 * Get plural content label
 */
export function getContentLabelPlural(capitalize = false) {
    const isManga = isMangaSource();
    const label = isManga ? 'manga' : 'novels';
    return capitalize ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/**
 * Get the app title based on active source
 */
export function getAppTitle() {
    const isManga = isMangaSource();
    return isManga ? 'MANGA DOWNLOADER' : 'NOVEL DOWNLOADER';
}

/**
 * Get the app subtitle
 */
export function getAppSubtitle() {
    const label = getContentLabelPlural();
    return `Download & export ${label} from multiple sources`;
}

/**
 * Draw a box around text
 */
export function drawBox(lines, options = {}) {
    const {
        width = 60,
        padding = 1,
        borderColor = theme.primary,
        titleColor = theme.highlight,
    } = options;

    const innerWidth = width - 2;
    const output = [];

    // Top border
    output.push(borderColor(`${box.topLeft}${box.horizontal.repeat(innerWidth)}${box.topRight}`));

    // Content lines with padding
    for (let i = 0; i < padding; i++) {
        output.push(borderColor(box.vertical) + ' '.repeat(innerWidth) + borderColor(box.vertical));
    }

    for (const line of lines) {
        const stripped = stripAnsi(line);
        const paddingNeeded = innerWidth - stripped.length - 2;
        const leftPad = ' ';
        const rightPad = ' '.repeat(Math.max(0, paddingNeeded));
        output.push(borderColor(box.vertical) + leftPad + line + rightPad + borderColor(box.vertical));
    }

    for (let i = 0; i < padding; i++) {
        output.push(borderColor(box.vertical) + ' '.repeat(innerWidth) + borderColor(box.vertical));
    }

    // Bottom border
    output.push(borderColor(`${box.bottomLeft}${box.horizontal.repeat(innerWidth)}${box.bottomRight}`));

    return output.join('\n');
}

/**
 * Strip ANSI codes from string (for length calculation)
 */
function stripAnsi(str) {
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Draw a section header
 */
export function sectionHeader(title) {
    const line = box.horizontal.repeat(3);
    return theme.primary(`${line} ${theme.highlight(title)} ${line}`);
}

/**
 * Draw a divider line
 */
export function divider(width = 50) {
    return theme.muted(box.horizontal.repeat(width));
}

/**
 * Create the main banner
 */
export function getBanner() {
    const activeSource = getActiveSource();
    const sourceName = activeSource ? activeSource.name : 'No source selected';
    const sourceType = activeSource?.contentType === 'manga' ? '📚' : '📖';

    const title = getAppTitle();
    const subtitle = getAppSubtitle();

    const lines = [
        theme.highlight(title),
        theme.muted(subtitle),
        '',
        `${sourceType}  ${theme.warning('Source:')} ${theme.highlight(sourceName)}`,
    ];

    return '\n' + drawBox(lines, { width: 62, padding: 1 }) + '\n';
}

/**
 * Create a progress bar
 */
export function progressBar(current, total, width = 30) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    const bar = theme.success('█'.repeat(filled)) + theme.muted('░'.repeat(empty));
    return `${bar} ${theme.highlight(`${percentage}%`)}`;
}

/**
 * Create a status indicator
 */
export function statusIndicator(status) {
    const indicators = {
        success: theme.success('✓'),
        error: theme.error('✗'),
        warning: theme.warning('⚠'),
        info: theme.primary('ℹ'),
        pending: theme.muted('○'),
        active: theme.success('●'),
        loading: theme.primary('◌'),
    };
    return indicators[status] || indicators.info;
}

/**
 * Format a key-value pair for display
 */
export function keyValue(key, value, keyWidth = 12) {
    const paddedKey = key.padEnd(keyWidth);
    return `${theme.muted(paddedKey)} ${theme.highlight(value)}`;
}

/**
 * Format a list item
 */
export function listItem(text, indent = 2) {
    return ' '.repeat(indent) + theme.muted('•') + ' ' + text;
}

/**
 * Show a success message
 */
export function success(message) {
    return `${statusIndicator('success')} ${theme.success(message)}`;
}

/**
 * Show an error message
 */
export function error(message) {
    return `${statusIndicator('error')} ${theme.error(message)}`;
}

/**
 * Show a warning message
 */
export function warning(message) {
    return `${statusIndicator('warning')} ${theme.warning(message)}`;
}

/**
 * Show an info message
 */
export function info(message) {
    return `${statusIndicator('info')} ${theme.primary(message)}`;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format duration in seconds to human readable
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
 * Create a simple spinner animation frames
 */
export const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Animated loading text (call repeatedly with incrementing frame)
 */
export function loadingText(message, frame = 0) {
    const spinner = spinnerFrames[frame % spinnerFrames.length];
    return `${theme.primary(spinner)} ${theme.muted(message)}`;
}

/**
 * Clear line and move cursor to beginning
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
 * Create a table-like display for items
 */
export function formatTable(rows, columns) {
    const output = [];

    for (const row of rows) {
        let line = '';
        for (const col of columns) {
            const value = row[col.key] || '';
            const formatted = col.format ? col.format(value, row) : String(value);
            line += formatted.padEnd(col.width || 20);
        }
        output.push(line);
    }

    return output.join('\n');
}

/**
 * Create choice objects for inquirer with consistent styling
 */
export function menuChoice(name, value, description = null) {
    if (description) {
        return {
            name: `${name} ${theme.muted(`- ${description}`)}`,
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
        name: theme.muted(`← ${label}`),
        value: null
    };
}

/**
 * Show details in a formatted panel
 */
export function detailsPanel(title, details) {
    const output = [sectionHeader(title), ''];

    for (const [key, value] of Object.entries(details)) {
        if (value !== null && value !== undefined && value !== '') {
            output.push(keyValue(key, value));
        }
    }

    return output.join('\n');
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
export function center(text, width = 60) {
    const stripped = stripAnsi(text);
    const padding = Math.max(0, Math.floor((width - stripped.length) / 2));
    return ' '.repeat(padding) + text;
}

/**
 * Wait for user to press enter
 */
export async function pressEnter(message = 'Press Enter to continue...') {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(theme.muted(`\n${message}`), () => {
            rl.close();
            resolve();
        });
    });
}

/**
 * Get styled inquirer prompt options
 */
export function promptConfig(options = {}) {
    return {
        loop: false,
        pageSize: 12,
        ...options
    };
}
