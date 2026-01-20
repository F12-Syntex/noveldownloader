/**
 * Downloader Module
 * Handles downloading novels and manga with retry logic and progress tracking
 */

import { getChapterContent, fetchImage, isMangaSource } from './scraper.js';
import { getActiveSource } from './sourceManager.js';
import * as storage from './storage.js';
import { log } from './logger.js';
import chalk from 'chalk';
import fetch from 'node-fetch';

const DOWNLOAD_CONFIG = {
    maxRetries: 3,
    retryDelay: 2000,
    delayBetweenChapters: 400,
};

/**
 * Format seconds into human readable time
 */
function formatTime(seconds) {
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
 * Clear the current line and write new content
 */
function updateLine(text) {
    // Handle non-TTY environments gracefully
    if (process.stdout.isTTY && process.stdout.clearLine) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(text);
    } else if (text) {
        // For non-TTY, just write on a new line if there's content
        console.log(text);
    }
}

/**
 * Download a single chapter with retry logic (handles both novels and manga)
 */
async function downloadChapter(novelTitle, chapter, isManga = false, attempt = 1) {
    try {
        const content = await getChapterContent(chapter.url);

        if (isManga || content.type === 'manga') {
            // Download manga images
            if (!content.images || content.images.length === 0) {
                throw new Error('No images found in chapter');
            }

            log.debug(`Downloading ${content.images.length} images for chapter ${chapter.number}`);
            const imageBuffers = await downloadMangaImages(content.images);

            if (imageBuffers.length === 0) {
                throw new Error('Failed to download any images');
            }

            await storage.saveMangaChapter(novelTitle, chapter.number, chapter.title, imageBuffers);

            return {
                success: true,
                chapterNum: chapter.number,
                pageCount: imageBuffers.length,
                type: 'manga'
            };
        } else {
            // Save novel text
            await storage.saveChapter(novelTitle, chapter.number, chapter.title, content.content);

            return {
                success: true,
                chapterNum: chapter.number,
                wordCount: content.wordCount,
                type: 'novel'
            };
        }
    } catch (error) {
        if (attempt < DOWNLOAD_CONFIG.maxRetries) {
            log.download.retry(chapter.number, attempt, DOWNLOAD_CONFIG.maxRetries);
            await new Promise(r => setTimeout(r, DOWNLOAD_CONFIG.retryDelay * attempt));
            return downloadChapter(novelTitle, chapter, isManga, attempt + 1);
        }

        log.download.chapterFailed(chapter.number, chapter.title, error);
        return {
            success: false,
            chapterNum: chapter.number,
            error: error.message
        };
    }
}

/**
 * Download manga images from URLs
 */
async function downloadMangaImages(imageUrls) {
    const buffers = [];
    const source = getActiveSource();
    const userAgent = source?.http?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const referer = source?.baseUrl ? source.baseUrl + '/' : '';

    log.debug(`Starting download of ${imageUrls.length} images`);

    for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': userAgent,
                    'Referer': referer,
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                },
                timeout: 30000
            });

            if (!response.ok) {
                log.warn(`Failed to download image ${i + 1}/${imageUrls.length}: ${response.status}`);
                continue;
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > 0) {
                buffers.push(buffer);
            } else {
                log.warn(`Empty buffer for image ${i + 1}`);
            }

            // Small delay between image downloads
            await new Promise(r => setTimeout(r, 100));
        } catch (err) {
            log.warn(`Error downloading image ${i + 1}/${imageUrls.length}`, { error: err.message });
        }
    }

    log.debug(`Downloaded ${buffers.length}/${imageUrls.length} images`);
    return buffers;
}

/**
 * Download all chapters of a novel or manga
 */
export async function downloadNovel(novel, options = {}) {
    const {
        onProgress = null,
        skipExisting = true,
        startFrom = 1
    } = options;

    const isManga = novel.contentType === 'manga';
    const contentLabel = isManga ? 'manga' : 'novel';

    log.download.start(novel.title, novel.chapters.length);

    // Save metadata first
    await storage.saveMetadata(novel);

    // Download cover if available
    if (novel.cover) {
        try {
            const coverBuffer = await fetchImage(novel.cover);
            if (coverBuffer) {
                await storage.saveCover(novel.title, coverBuffer);
            }
        } catch (err) {
            log.warn('Failed to download cover image', { error: err.message });
        }
    }

    // Get already downloaded chapters (different check for manga vs novel)
    const downloadedChapters = skipExisting
        ? (isManga
            ? await storage.getDownloadedMangaChapters(novel.title)
            : await storage.getDownloadedChapters(novel.title))
        : [];

    const downloadedSet = new Set(downloadedChapters);

    log.debug(`Content type: ${novel.contentType}, isManga: ${isManga}`);
    log.debug(`Total chapters in novel: ${novel.chapters.length}`);
    log.debug(`Already downloaded: ${downloadedChapters.length} chapters`);
    if (novel.chapters.length > 0) {
        log.debug(`First chapter: num=${novel.chapters[0].number}, title="${novel.chapters[0].title}"`);
    }

    // Load previous failed chapters to retry
    const previousState = await storage.loadDownloadState(novel.title);
    const previouslyFailed = new Set((previousState?.failedChapters || []).map(c => c.number));

    // Filter chapters to download (not yet downloaded, or previously failed)
    const chaptersToDownload = novel.chapters.filter(ch =>
        ch.number >= startFrom && (!downloadedSet.has(ch.number) || previouslyFailed.has(ch.number))
    );

    log.debug(`Chapters to download after filtering: ${chaptersToDownload.length}`);

    if (chaptersToDownload.length === 0) {
        console.log(chalk.green('All chapters already downloaded!'));
        return {
            success: true,
            downloaded: 0,
            failed: 0,
            skipped: novel.chapters.length,
            failedChapters: []
        };
    }

    const skippedCount = downloadedSet.size - previouslyFailed.size;
    const retryCount = previouslyFailed.size;

    console.log(chalk.white(`Chapters: ${chaptersToDownload.length} to download`) +
        (skippedCount > 0 ? chalk.gray(` (${skippedCount} cached)`) : '') +
        (retryCount > 0 ? chalk.yellow(` (${retryCount} retrying)`) : ''));
    console.log();

    const results = {
        downloaded: 0,
        failed: 0,
        failedChapters: [],
        totalWordCount: 0
    };

    const startTime = Date.now();

    // Download chapters sequentially
    for (let i = 0; i < chaptersToDownload.length; i++) {
        const chapter = chaptersToDownload[i];

        // Calculate ETA based on total elapsed time
        let eta = '';
        if (i > 0) {
            const elapsed = Date.now() - startTime;
            const avgTimePerChapter = elapsed / i;
            const remaining = (chaptersToDownload.length - i) * avgTimePerChapter;
            eta = formatTime(remaining / 1000);
        }

        const progress = Math.round((i / chaptersToDownload.length) * 100);
        const progressBar = createProgressBar(progress, 20);

        updateLine(`${progressBar} ${i}/${chaptersToDownload.length} | Ch.${chapter.number} | ETA: ${eta || '--'}`);

        const result = await downloadChapter(novel.title, chapter, isManga);

        if (result.success) {
            results.downloaded++;
            if (isManga) {
                results.totalPages = (results.totalPages || 0) + (result.pageCount || 0);
            } else {
                results.totalWordCount += result.wordCount || 0;
            }
            log.download.chapter(chapter.number, chapter.title, 'SUCCESS');
        } else {
            results.failed++;
            results.failedChapters.push({
                number: chapter.number,
                title: chapter.title,
                url: chapter.url,
                error: result.error
            });
            log.download.chapterFailed(chapter.number, chapter.title, { message: result.error });
        }

        if (onProgress) {
            onProgress({
                current: i + 1,
                total: chaptersToDownload.length,
                chapter: chapter.number,
                success: result.success
            });
        }

        // Save download state periodically
        if ((i + 1) % 20 === 0) {
            await storage.saveDownloadState(novel.title, {
                lastChapter: chapter.number,
                downloadedCount: downloadedSet.size + results.downloaded,
                failedChapters: results.failedChapters,
                lastUpdated: new Date().toISOString()
            });
        }

        // Delay between chapters to avoid rate limiting
        if (i < chaptersToDownload.length - 1) {
            await new Promise(r => setTimeout(r, DOWNLOAD_CONFIG.delayBetweenChapters));
        }
    }

    // Clear progress line and show final stats
    updateLine('');
    console.log();

    const totalTime = (Date.now() - startTime) / 1000;

    // Save final state
    await storage.saveDownloadState(novel.title, {
        completed: results.failed === 0,
        downloadedCount: downloadedSet.size + results.downloaded,
        failedChapters: results.failedChapters,
        totalWordCount: results.totalWordCount,
        lastUpdated: new Date().toISOString()
    });

    log.download.complete(novel.title, results.downloaded, results.failed, novel.chapters.length);

    // Summary
    console.log(chalk.green(`Done: ${results.downloaded} downloaded`) +
        (results.failed > 0 ? chalk.red(` | ${results.failed} failed`) : '') +
        chalk.gray(` | ${formatTime(totalTime)}`));

    return {
        success: results.failed === 0,
        downloaded: results.downloaded,
        failed: results.failed,
        skipped: skippedCount,
        failedChapters: results.failedChapters,
        totalWordCount: results.totalWordCount
    };
}

/**
 * Create a simple progress bar string
 */
function createProgressBar(percentage, width = 20) {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return chalk.green('\u2588'.repeat(filled)) + chalk.gray('\u2591'.repeat(empty));
}

/**
 * Retry failed chapters
 */
export async function retryFailedChapters(novelName) {
    const state = await storage.loadDownloadState(novelName);
    if (!state || !state.failedChapters || state.failedChapters.length === 0) {
        console.log(chalk.green('No failed chapters to retry!'));
        return { success: true, retried: 0 };
    }

    const novel = await storage.getNovel(storage.sanitizeName(novelName));
    if (!novel) {
        log.error(`Novel not found: ${novelName}`);
        return { success: false, error: 'Novel not found' };
    }

    console.log(chalk.yellow(`Retrying ${state.failedChapters.length} failed chapters...`));
    console.log();

    const stillFailed = [];
    let successCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < state.failedChapters.length; i++) {
        const chapter = state.failedChapters[i];
        const progress = Math.round((i / state.failedChapters.length) * 100);
        const progressBar = createProgressBar(progress, 20);

        updateLine(`${progressBar} ${i}/${state.failedChapters.length} | Ch.${chapter.number}`);

        const result = await downloadChapter(novel.title, chapter);

        if (result.success) {
            successCount++;
            log.download.chapter(chapter.number, chapter.title, 'RETRY SUCCESS');
        } else {
            stillFailed.push(chapter);
        }

        if (i < state.failedChapters.length - 1) {
            await new Promise(r => setTimeout(r, DOWNLOAD_CONFIG.delayBetweenChapters));
        }
    }

    updateLine('');
    console.log();

    const totalTime = (Date.now() - startTime) / 1000;

    // Update state with remaining failed chapters
    await storage.saveDownloadState(novelName, {
        ...state,
        failedChapters: stillFailed,
        lastUpdated: new Date().toISOString()
    });

    console.log(chalk.green(`Retried: ${successCount} recovered`) +
        (stillFailed.length > 0 ? chalk.red(` | ${stillFailed.length} still failed`) : '') +
        chalk.gray(` | ${formatTime(totalTime)}`));

    return {
        success: stillFailed.length === 0,
        retried: successCount,
        stillFailed: stillFailed.length
    };
}

/**
 * Resume an incomplete download
 */
export async function resumeDownload(novelName) {
    const novel = await storage.getNovel(storage.sanitizeName(novelName));
    if (!novel) {
        log.error(`Novel not found: ${novelName}`);
        return { success: false, error: 'Novel not found' };
    }

    console.log(chalk.cyan(`\nResuming download for: ${novel.title}`));

    return downloadNovel(novel, { skipExisting: true });
}

/**
 * Get download progress for a novel
 */
export async function getDownloadProgress(novelName) {
    const stats = await storage.getDownloadStats(novelName);
    if (!stats) {
        return null;
    }

    const percentage = stats.totalChapters > 0
        ? Math.round((stats.downloadedCount / stats.totalChapters) * 100)
        : 0;

    return {
        ...stats,
        percentage,
        missingChapters: getMissingChapters(stats.downloadedChapters, stats.totalChapters)
    };
}

/**
 * Get list of missing chapter numbers
 */
function getMissingChapters(downloadedChapters, totalChapters) {
    const downloaded = new Set(downloadedChapters);
    const missing = [];

    for (let i = 1; i <= totalChapters; i++) {
        if (!downloaded.has(i)) {
            missing.push(i);
        }
    }

    return missing;
}

export { DOWNLOAD_CONFIG };
