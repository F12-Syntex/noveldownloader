/**
 * Torrent Download Module
 * Handles downloading torrents using WebTorrent
 */

import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs/promises';
import { log } from './logger.js';
import { isVideoFile, formatSize } from './nyaa.js';
import * as ui from './ui.js';

// Default download directory
const DEFAULT_DOWNLOAD_DIR = 'downloads/anime';

// Singleton client instance
let client = null;

/**
 * Get or create WebTorrent client
 */
function getClient() {
    if (!client) {
        client = new WebTorrent();

        client.on('error', (err) => {
            log.error('WebTorrent client error', { error: err.message });
        });
    }
    return client;
}

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
        const client = getClient();

        const timeoutId = setTimeout(() => {
            reject(new Error('Timeout while fetching torrent metadata'));
        }, timeout);

        const opts = {
            path: DEFAULT_DOWNLOAD_DIR,
            destroyStoreOnDestroy: true,
        };

        client.add(magnetOrTorrent, opts, (torrent) => {
            clearTimeout(timeoutId);

            // Deselect all files initially (don't download)
            torrent.files.forEach(file => {
                file.deselect();
            });

            const files = torrent.files.map((file, index) => ({
                index,
                name: file.name,
                path: file.path,
                size: file.length,
                sizeFormatted: formatSize(file.length),
                isVideo: isVideoFile(file.name),
            }));

            // Store torrent reference for later use
            resolve({
                infoHash: torrent.infoHash,
                name: torrent.name,
                totalSize: torrent.length,
                totalSizeFormatted: formatSize(torrent.length),
                files,
                torrent, // Keep reference for downloading
            });
        });

        client.on('error', (err) => {
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

    const torrent = torrentInfo.torrent;

    if (!torrent) {
        throw new Error('No torrent reference available');
    }

    // Deselect all files first
    torrent.files.forEach(file => {
        file.deselect();
    });

    // Select only the files we want
    const selectedFiles = [];
    for (const index of fileIndices) {
        if (index >= 0 && index < torrent.files.length) {
            const file = torrent.files[index];
            file.select();
            selectedFiles.push({
                index,
                name: file.name,
                path: file.path,
                size: file.length,
            });
        }
    }

    if (selectedFiles.length === 0) {
        throw new Error('No valid files selected');
    }

    log.info(`Downloading ${selectedFiles.length} file(s)`);

    return new Promise((resolve, reject) => {
        let lastProgress = 0;

        // Progress tracking
        const progressInterval = setInterval(() => {
            const progress = Math.round(torrent.progress * 100);
            const downloaded = torrent.downloaded;
            const speed = torrent.downloadSpeed;
            const peers = torrent.numPeers;

            if (progress !== lastProgress || onProgress) {
                lastProgress = progress;

                if (onProgress) {
                    onProgress({
                        progress,
                        downloaded,
                        downloadedFormatted: formatSize(downloaded),
                        speed,
                        speedFormatted: formatSize(speed) + '/s',
                        peers,
                        eta: speed > 0 ? Math.round((torrent.length - downloaded) / speed) : null,
                    });
                }
            }
        }, 1000);

        torrent.on('done', () => {
            clearInterval(progressInterval);

            // Get final file paths
            const downloadedFiles = selectedFiles.map(f => ({
                name: f.name,
                path: path.join(downloadDir, torrent.name, f.path),
                size: f.size,
            }));

            log.info('Download complete', { files: downloadedFiles.map(f => f.name) });
            resolve({
                success: true,
                files: downloadedFiles,
                totalSize: selectedFiles.reduce((sum, f) => sum + f.size, 0),
            });
        });

        torrent.on('error', (err) => {
            clearInterval(progressInterval);
            log.error('Torrent download error', { error: err.message });
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
        const client = getClient();

        const opts = {
            path: downloadDir,
        };

        client.add(magnetOrTorrent, opts, (torrent) => {
            log.info(`Started downloading: ${torrent.name}`);

            let lastProgress = 0;

            const progressInterval = setInterval(() => {
                const progress = Math.round(torrent.progress * 100);
                const downloaded = torrent.downloaded;
                const speed = torrent.downloadSpeed;
                const peers = torrent.numPeers;

                if (progress !== lastProgress || onProgress) {
                    lastProgress = progress;

                    if (onProgress) {
                        onProgress({
                            progress,
                            downloaded,
                            downloadedFormatted: formatSize(downloaded),
                            speed,
                            speedFormatted: formatSize(speed) + '/s',
                            peers,
                            eta: speed > 0 ? Math.round((torrent.length - downloaded) / speed) : null,
                        });
                    }
                }
            }, 1000);

            torrent.on('done', () => {
                clearInterval(progressInterval);

                const files = torrent.files.map(f => ({
                    name: f.name,
                    path: path.join(downloadDir, torrent.name, f.path),
                    size: f.length,
                }));

                log.info('Download complete', { name: torrent.name });
                resolve({
                    success: true,
                    name: torrent.name,
                    files,
                    totalSize: torrent.length,
                });
            });

            torrent.on('error', (err) => {
                clearInterval(progressInterval);
                reject(err);
            });
        });

        client.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Remove a torrent from client
 */
export function removeTorrent(infoHash) {
    const client = getClient();
    const torrent = client.get(infoHash);

    if (torrent) {
        torrent.destroy();
        log.debug(`Removed torrent: ${infoHash}`);
        return true;
    }
    return false;
}

/**
 * Get active downloads
 */
export function getActiveDownloads() {
    const client = getClient();
    return client.torrents.map(t => ({
        infoHash: t.infoHash,
        name: t.name,
        progress: Math.round(t.progress * 100),
        downloadSpeed: t.downloadSpeed,
        uploadSpeed: t.uploadSpeed,
        numPeers: t.numPeers,
        downloaded: t.downloaded,
        uploaded: t.uploaded,
        done: t.done,
    }));
}

/**
 * Stop all downloads and destroy client
 */
export function destroyClient() {
    if (client) {
        client.destroy();
        client = null;
        log.debug('WebTorrent client destroyed');
    }
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
