/**
 * Video Utilities
 * Handles video operations like extracting segments using ffmpeg
 */

import { spawn } from 'child_process';
import { log } from '../logger.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * Check if ffmpeg is available
 * @returns {Promise<boolean>}
 */
export async function checkFfmpeg() {
    return new Promise((resolve) => {
        const proc = spawn('ffmpeg', ['-version'], { shell: true });
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
    });
}

/**
 * Get video duration using ffprobe
 * @param {string} filePath - Path to video file
 * @returns {Promise<number>} Duration in seconds
 */
export async function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
        ], { shell: true });

        let output = '';
        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
            if (code === 0) {
                const duration = parseFloat(output.trim());
                resolve(isNaN(duration) ? 0 : duration);
            } else {
                reject(new Error('Failed to get video duration'));
            }
        });
    });
}

/**
 * Extract a segment from a video file
 * @param {string} inputPath - Path to input video
 * @param {string} outputPath - Path for output segment
 * @param {Object} options - Extraction options
 * @returns {Promise<Object>}
 */
export async function extractSegment(inputPath, outputPath, options = {}) {
    const {
        startTime = 0,          // Start time in seconds
        duration = 30,          // Duration in seconds
        onProgress = null
    } = options;

    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
        throw new Error('ffmpeg is not installed. Please install ffmpeg to use this feature.');
    }

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
        const args = [
            '-y',                           // Overwrite output
            '-ss', startTime.toString(),    // Start time (before input for fast seek)
            '-i', inputPath,                // Input file
            '-t', duration.toString(),      // Duration
            '-c', 'copy',                   // Copy codecs (fast, no re-encoding)
            '-avoid_negative_ts', 'make_zero',
            outputPath
        ];

        log.debug(`Extracting segment: ffmpeg ${args.join(' ')}`);

        const proc = spawn('ffmpeg', args, { shell: true });

        let stderr = '';
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            // Parse progress if callback provided
            if (onProgress) {
                const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2})/);
                if (timeMatch) {
                    const currentTime =
                        parseInt(timeMatch[1]) * 3600 +
                        parseInt(timeMatch[2]) * 60 +
                        parseInt(timeMatch[3]);
                    const progress = Math.min(100, Math.round((currentTime / duration) * 100));
                    onProgress({ progress, currentTime, totalTime: duration });
                }
            }
        });

        proc.on('error', (err) => {
            log.error('ffmpeg error', { error: err.message });
            reject(err);
        });

        proc.on('close', async (code) => {
            if (code === 0) {
                try {
                    const stats = await fs.stat(outputPath);
                    resolve({
                        success: true,
                        outputPath,
                        size: stats.size,
                        startTime,
                        duration
                    });
                } catch (err) {
                    reject(new Error('Output file not created'));
                }
            } else {
                log.error('ffmpeg failed', { code, stderr: stderr.slice(-500) });
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });
    });
}

/**
 * Generate a random timestamp within video duration
 * @param {number} videoDuration - Total video duration in seconds
 * @param {number} segmentDuration - Desired segment duration
 * @returns {number} Random start time in seconds
 */
export function getRandomTimestamp(videoDuration, segmentDuration = 30) {
    // Ensure we don't start too close to the end
    const maxStart = Math.max(0, videoDuration - segmentDuration - 10);
    // Avoid the first 30 seconds (usually intros)
    const minStart = Math.min(30, maxStart);

    if (maxStart <= minStart) {
        return 0;
    }

    return Math.floor(Math.random() * (maxStart - minStart)) + minStart;
}

/**
 * Format seconds to HH:MM:SS
 * @param {number} seconds
 * @returns {string}
 */
export function formatTimestamp(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse timestamp string to seconds
 * Supports: "1:30", "1:30:00", "90", "1m30s", "1h30m"
 * @param {string} timestamp
 * @returns {number} Seconds
 */
export function parseTimestamp(timestamp) {
    if (!timestamp || typeof timestamp !== 'string') {
        return 0;
    }

    const trimmed = timestamp.trim();

    // Pure number (seconds)
    if (/^\d+$/.test(trimmed)) {
        return parseInt(trimmed);
    }

    // HH:MM:SS or MM:SS format
    if (trimmed.includes(':')) {
        const parts = trimmed.split(':').map(p => parseInt(p) || 0);
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
    }

    // 1h30m30s format
    const hMatch = trimmed.match(/(\d+)\s*h/i);
    const mMatch = trimmed.match(/(\d+)\s*m/i);
    const sMatch = trimmed.match(/(\d+)\s*s/i);

    let seconds = 0;
    if (hMatch) seconds += parseInt(hMatch[1]) * 3600;
    if (mMatch) seconds += parseInt(mMatch[1]) * 60;
    if (sMatch) seconds += parseInt(sMatch[1]);

    return seconds;
}

/**
 * Parse duration string to seconds
 * @param {string} duration
 * @returns {number} Seconds
 */
export function parseDuration(duration) {
    return parseTimestamp(duration);
}

export default {
    checkFfmpeg,
    getVideoDuration,
    extractSegment,
    getRandomTimestamp,
    formatTimestamp,
    parseTimestamp,
    parseDuration
};
