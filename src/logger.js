/**
 * Logger Module
 * Provides sophisticated logging with file and console output
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs/promises';

const LOG_DIR = 'logs';

// Detailed logs flag (controlled by settings)
let detailedLogsEnabled = false;

export function setDetailedLogs(enabled) {
    detailedLogsEnabled = enabled;
}

// Ensure log directory exists
async function ensureLogDir() {
    try {
        await fs.mkdir(LOG_DIR, { recursive: true });
    } catch (err) {
        // Directory might already exist
    }
}

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const levelColors = {
            error: '\x1b[31m',   // Red
            warn: '\x1b[33m',    // Yellow
            info: '\x1b[36m',    // Cyan
            debug: '\x1b[90m',   // Gray
        };
        const reset = '\x1b[0m';
        const color = levelColors[level] || '';
        return `${color}[${timestamp}] [${level.toUpperCase()}]${reset} ${message}${metaStr}`;
    })
);

// Custom format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
    level: 'debug',
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat,
            level: 'info'
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'app.log'),
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // Separate file for errors only
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            format: fileFormat,
            level: 'error',
            maxsize: 5242880,
            maxFiles: 3
        })
    ]
});

// Initialize log directory (async but don't block module loading)
ensureLogDir().catch(err => console.error('Failed to create log directory:', err));

// Helper functions for common logging patterns
export const log = {
    info: (message, meta = {}) => logger.info(message, meta),
    error: (message, meta = {}) => logger.error(message, meta),
    warn: (message, meta = {}) => logger.warn(message, meta),
    debug: (message, meta = {}) => logger.debug(message, meta),

    // Verbose info - only shows in console if detailed logs enabled
    verbose: (message, meta = {}) => {
        if (detailedLogsEnabled) {
            logger.info(message, meta);
        } else {
            logger.debug(message, meta); // Still log to file as debug
        }
    },

    // Specialized logging functions
    download: {
        start: (novelTitle, totalChapters) => {
            logger.info(`Starting download: ${novelTitle}`, { type: 'download_start', totalChapters });
        },
        chapter: (chapterNum, title, status) => {
            if (detailedLogsEnabled) {
                logger.info(`Chapter ${chapterNum}: ${title} - ${status}`, { type: 'chapter', chapterNum, status });
            } else {
                logger.debug(`Chapter ${chapterNum}: ${title} - ${status}`, { type: 'chapter', chapterNum, status });
            }
        },
        chapterFailed: (chapterNum, title, error) => {
            logger.error(`Chapter ${chapterNum} failed: ${title}`, { type: 'chapter_failed', chapterNum, error: error.message });
        },
        complete: (novelTitle, successCount, failedCount, totalChapters) => {
            logger.info(`Download complete: ${novelTitle}`, {
                type: 'download_complete',
                successCount,
                failedCount,
                totalChapters
            });
        },
        retry: (chapterNum, attempt, maxAttempts) => {
            if (detailedLogsEnabled) {
                logger.warn(`Retrying chapter ${chapterNum} (${attempt}/${maxAttempts})`, { type: 'retry', chapterNum, attempt });
            } else {
                logger.debug(`Retrying chapter ${chapterNum} (${attempt}/${maxAttempts})`, { type: 'retry', chapterNum, attempt });
            }
        }
    },

    search: {
        query: (query) => {
            logger.debug(`Searching for: ${query}`, { type: 'search', query });
        },
        results: (count) => {
            logger.debug(`Found ${count} results`, { type: 'search_results', count });
        }
    },

    export: {
        start: (novelTitle, format) => {
            logger.debug(`Exporting ${novelTitle} to ${format}`, { type: 'export_start', format });
        },
        complete: (novelTitle, format, outputPath) => {
            logger.info(`Export complete: ${outputPath}`, { type: 'export_complete', format, outputPath });
        },
        failed: (novelTitle, format, error) => {
            logger.error(`Export failed: ${novelTitle}`, { type: 'export_failed', format, error: error.message });
        }
    }
};

export default logger;
