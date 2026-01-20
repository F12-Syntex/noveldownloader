/**
 * Torrent Download Module
 * Handles downloading torrents using torrent-stream (traditional BitTorrent)
 */

import torrentStream from 'torrent-stream';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { log } from './logger.js';
import { isVideoFile, formatSize } from './nyaa.js';
import * as ui from './ui.js';

// Default download directory
const DEFAULT_DOWNLOAD_DIR = 'downloads/anime';

// Additional trackers to improve connectivity
const TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.tiny-vps.com:6969/announce',
    'udp://tracker.pomf.se:80/announce',
    'udp://explodie.org:6969/announce',
    'http://nyaa.tracker.wf:7777/announce',
    'http://anidex.moe:6969/announce',
    'http://tracker.anirena.com:80/announce'
];

// Active engines for cleanup
const activeEngines = new Map();

/**
 * Ensure download directory exists
 */
async function ensureDownloadDir(dir) {
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/**
 * Get file info from a torrent without downloading
 */
export async function getTorrentFiles(magnetOrTorrent, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            if (engine) engine.destroy();
            reject(new Error('Timeout while fetching torrent metadata'));
        }, timeout);

        const engine = torrentStream(magnetOrTorrent, {
            trackers: TRACKERS,
            tmp: DEFAULT_DOWNLOAD_DIR,
            connections: 100,
            uploads: 0,      // Don't upload while just getting metadata
            verify: true,
            dht: true
        });

        engine.on('ready', () => {
            clearTimeout(timeoutId);

            const files = engine.files.map((file, index) => ({
                index,
                name: file.name,
                path: file.path,
                size: file.length,
                sizeFormatted: formatSize(file.length),
                isVideo: isVideoFile(file.name),
                _file: file  // Keep reference for downloading
            }));

            const totalSize = engine.files.reduce((sum, f) => sum + f.length, 0);

            // Store engine for later use
            const infoHash = engine.infoHash;
            activeEngines.set(infoHash, engine);

            resolve({
                infoHash,
                name: engine.torrent.name,
                totalSize,
                totalSizeFormatted: formatSize(totalSize),
                files,
                engine, // Keep reference for downloading
            });
        });

        engine.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        });
    });
}

/**
 * Estimate bytes needed for a video segment
 * @param {number} fileSize - Total file size in bytes
 * @param {number} duration - Desired duration in seconds
 * @param {number} estimatedTotalDuration - Estimated total video duration (default: based on size)
 * @returns {number} Estimated bytes needed
 */
function estimateBytesForDuration(fileSize, duration, estimatedTotalDuration = null) {
    // Estimate total duration if not provided
    // Assume ~5 Mbps average bitrate for anime (reasonable for 720p-1080p)
    // 5 Mbps = 625 KB/s = 37.5 MB/min
    if (!estimatedTotalDuration) {
        const avgBitrateBps = 5 * 1024 * 1024 / 8; // 5 Mbps in bytes/sec
        estimatedTotalDuration = fileSize / avgBitrateBps;
    }

    // Calculate bytes per second for this file
    const bytesPerSecond = fileSize / estimatedTotalDuration;

    // Add 50% buffer for keyframes and overhead
    const bytesNeeded = Math.ceil(bytesPerSecond * duration * 1.5);

    // Minimum 50MB, maximum full file
    return Math.min(fileSize, Math.max(50 * 1024 * 1024, bytesNeeded));
}

/**
 * Download specific files from a torrent
 * @param {Object} torrentInfo - Torrent info
 * @param {number[]} fileIndices - File indices to download
 * @param {Object} options - Download options
 */
export async function downloadFiles(torrentInfo, fileIndices, options = {}) {
    const {
        downloadDir = DEFAULT_DOWNLOAD_DIR,
        onProgress = null,
        partialDownload = null,  // { duration: 30, timestamp: 0 or 'random' }
    } = options;

    await ensureDownloadDir(downloadDir);

    const engine = torrentInfo.engine;

    if (!engine) {
        throw new Error('No torrent engine available');
    }

    // Get selected files
    const selectedFiles = fileIndices
        .filter(idx => idx >= 0 && idx < torrentInfo.files.length)
        .map(idx => torrentInfo.files[idx]);

    if (selectedFiles.length === 0) {
        throw new Error('No valid files selected');
    }

    // Calculate total size - for partial downloads, estimate needed bytes
    let totalSize;
    let isPartial = false;
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.webm', '.mov'];

    if (partialDownload) {
        isPartial = true;
        totalSize = 0;
        for (const f of selectedFiles) {
            const isVideo = videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext));
            if (isVideo && partialDownload.duration) {
                // Estimate bytes needed for the segment
                totalSize += estimateBytesForDuration(f.size, partialDownload.duration);
            } else {
                totalSize += f.size;
            }
        }
        log.info(`Partial download: ~${formatSize(totalSize)} for ${partialDownload.duration}s segment`);
    } else {
        totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    }

    log.info(`Downloading ${selectedFiles.length} file(s), target: ${formatSize(totalSize)}`);

    return new Promise((resolve, reject) => {
        let downloadedBytes = 0;
        let completedFiles = 0;
        const downloadedFiles = [];
        let progressInterval;

        // Start downloading each selected file
        for (const fileInfo of selectedFiles) {
            const file = fileInfo._file;
            const outputPath = path.join(downloadDir, torrentInfo.name, file.path);
            const isVideo = videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

            // Calculate how much to download
            let bytesToDownload = file.length;
            if (isPartial && isVideo && partialDownload?.duration) {
                bytesToDownload = estimateBytesForDuration(file.length, partialDownload.duration);
            }

            // Ensure directory exists
            const outputDir = path.dirname(outputPath);
            fs.mkdir(outputDir, { recursive: true }).then(() => {
                // Create read stream - with byte limit for partial downloads
                const streamOptions = isPartial && isVideo ? { start: 0, end: bytesToDownload - 1 } : {};
                const readStream = file.createReadStream(streamOptions);
                const writeStream = createWriteStream(outputPath);

                let fileBytesDownloaded = 0;

                readStream.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    fileBytesDownloaded += chunk.length;
                });

                readStream.on('error', (err) => {
                    log.error(`Error reading file: ${file.name}`, { error: err.message });
                });

                writeStream.on('error', (err) => {
                    log.error(`Error writing file: ${file.name}`, { error: err.message });
                });

                writeStream.on('finish', () => {
                    completedFiles++;
                    downloadedFiles.push({
                        name: file.name,
                        path: outputPath,
                        size: fileBytesDownloaded,
                        fullSize: file.length,
                        isPartial: isPartial && isVideo
                    });

                    if (completedFiles === selectedFiles.length) {
                        if (progressInterval) clearInterval(progressInterval);
                        log.info('Download complete', { files: downloadedFiles.map(f => f.name) });
                        resolve({
                            success: true,
                            files: downloadedFiles,
                            totalSize: downloadedBytes,
                            isPartial
                        });
                    }
                });

                readStream.pipe(writeStream);
            }).catch(reject);
        }

        // Progress tracking
        progressInterval = setInterval(() => {
            const progress = Math.round((downloadedBytes / totalSize) * 100);
            const speed = engine.swarm.downloadSpeed();
            const peers = engine.swarm.wires.length;

            if (onProgress) {
                onProgress({
                    progress: Math.min(progress, 100),
                    downloaded: downloadedBytes,
                    downloadedFormatted: formatSize(downloadedBytes),
                    totalSize,
                    totalFormatted: formatSize(totalSize),
                    speed,
                    speedFormatted: formatSize(speed) + '/s',
                    peers,
                    eta: speed > 0 ? Math.round((totalSize - downloadedBytes) / speed) : null,
                    isPartial
                });
            }

            // Check if done
            if (completedFiles === selectedFiles.length) {
                clearInterval(progressInterval);
            }
        }, 1000);

        // Handle errors
        engine.on('error', (err) => {
            if (progressInterval) clearInterval(progressInterval);
            log.error('Torrent engine error', { error: err.message });
            reject(err);
        });
    });
}

/**
 * Download entire torrent
 */
export async function downloadTorrent(magnetOrTorrent, options = {}) {
    const {
        downloadDir = DEFAULT_DOWNLOAD_DIR,
        onProgress = null,
    } = options;

    await ensureDownloadDir(downloadDir);

    return new Promise((resolve, reject) => {
        const engine = torrentStream(magnetOrTorrent, {
            trackers: TRACKERS,
            path: downloadDir,
            connections: 100,
            verify: true,
            dht: true
        });

        engine.on('ready', () => {
            log.info(`Started downloading: ${engine.torrent.name}`);

            const totalSize = engine.files.reduce((sum, f) => sum + f.length, 0);
            let downloadedBytes = 0;
            let completedFiles = 0;
            const downloadedFiles = [];

            // Download all files
            for (const file of engine.files) {
                const outputPath = path.join(downloadDir, engine.torrent.name, file.path);
                const outputDir = path.dirname(outputPath);

                fs.mkdir(outputDir, { recursive: true }).then(() => {
                    const readStream = file.createReadStream();
                    const writeStream = createWriteStream(outputPath);

                    readStream.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                    });

                    writeStream.on('finish', () => {
                        completedFiles++;
                        downloadedFiles.push({
                            name: file.name,
                            path: outputPath,
                            size: file.length
                        });

                        if (completedFiles === engine.files.length) {
                            log.info('Download complete', { name: engine.torrent.name });
                            engine.destroy();
                            resolve({
                                success: true,
                                name: engine.torrent.name,
                                files: downloadedFiles,
                                totalSize
                            });
                        }
                    });

                    readStream.pipe(writeStream);
                });
            }

            // Progress tracking
            const progressInterval = setInterval(() => {
                const progress = Math.round((downloadedBytes / totalSize) * 100);
                const speed = engine.swarm.downloadSpeed();
                const peers = engine.swarm.wires.length;

                if (onProgress) {
                    onProgress({
                        progress: Math.min(progress, 100),
                        downloaded: downloadedBytes,
                        downloadedFormatted: formatSize(downloadedBytes),
                        speed,
                        speedFormatted: formatSize(speed) + '/s',
                        peers,
                        eta: speed > 0 ? Math.round((totalSize - downloadedBytes) / speed) : null,
                    });
                }

                if (completedFiles === engine.files.length) {
                    clearInterval(progressInterval);
                }
            }, 1000);
        });

        engine.on('error', (err) => {
            log.error('Torrent download error', { error: err.message });
            reject(err);
        });
    });
}

/**
 * Remove a torrent from active engines
 */
export function removeTorrent(infoHash) {
    const engine = activeEngines.get(infoHash);

    if (engine) {
        engine.destroy();
        activeEngines.delete(infoHash);
        log.debug(`Removed torrent: ${infoHash}`);
        return true;
    }
    return false;
}

/**
 * Get active downloads
 */
export function getActiveDownloads() {
    const downloads = [];
    for (const [infoHash, engine] of activeEngines) {
        downloads.push({
            infoHash,
            name: engine.torrent?.name || 'Unknown',
            downloadSpeed: engine.swarm.downloadSpeed(),
            uploadSpeed: engine.swarm.uploadSpeed(),
            numPeers: engine.swarm.wires.length,
        });
    }
    return downloads;
}

/**
 * Stop all downloads and destroy engines
 */
export function destroyClient() {
    for (const [infoHash, engine] of activeEngines) {
        engine.destroy();
    }
    activeEngines.clear();
    log.debug('All torrent engines destroyed');
}

/**
 * Format ETA seconds to human readable
 */
export function formatEta(seconds) {
    if (!seconds || seconds <= 0) return '--';

    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
}

/**
 * Create download progress display
 */
export function formatDownloadProgress(progressData) {
    const { progress, downloadedFormatted, speedFormatted, peers, eta } = progressData;

    const bar = ui.progressBar(progress, 100, 25);
    const etaStr = eta ? formatEta(eta) : '--';

    return `${bar} | ${downloadedFormatted} | ${speedFormatted} | ${peers} peers | ETA: ${etaStr}`;
}
