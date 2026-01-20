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
 * Download specific files from a torrent
 */
export async function downloadFiles(torrentInfo, fileIndices, options = {}) {
    const {
        downloadDir = DEFAULT_DOWNLOAD_DIR,
        onProgress = null,
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

    const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    log.info(`Downloading ${selectedFiles.length} file(s), total: ${formatSize(totalSize)}`);

    return new Promise((resolve, reject) => {
        let downloadedBytes = 0;
        let completedFiles = 0;
        const downloadedFiles = [];

        // Start downloading each selected file
        for (const fileInfo of selectedFiles) {
            const file = fileInfo._file;
            const outputPath = path.join(downloadDir, torrentInfo.name, file.path);

            // Ensure directory exists
            const outputDir = path.dirname(outputPath);
            fs.mkdir(outputDir, { recursive: true }).then(() => {
                // Create read stream from torrent
                const readStream = file.createReadStream();
                const writeStream = createWriteStream(outputPath);

                readStream.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
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
                        size: file.length
                    });

                    if (completedFiles === selectedFiles.length) {
                        log.info('Download complete', { files: downloadedFiles.map(f => f.name) });
                        resolve({
                            success: true,
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

            // Check if done
            if (completedFiles === selectedFiles.length) {
                clearInterval(progressInterval);
            }
        }, 1000);

        // Handle errors
        engine.on('error', (err) => {
            clearInterval(progressInterval);
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
