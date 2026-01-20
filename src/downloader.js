/**
 * Downloader Module
 * Handles downloading novels with retry logic and progress tracking
 */

import { getChapterContent, fetchImage } from './scraper.js';
import * as storage from './storage.js';
import { log } from './logger.js';
import chalk from 'chalk';

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
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(text);
}

/**
 * Download a single chapter with retry logic
 */
async function downloadChapter(novelTitle, chapter, attempt = 1) {
    try {
        const content = await getChapterContent(chapter.url);
        await storage.saveChapter(novelTitle, chapter.number, chapter.title, content.content);

        return {
            success: true,
            chapterNum: chapter.number,
            wordCount: content.wordCount
        };
    } catch (error) {
        if (attempt < DOWNLOAD_CONFIG.maxRetries) {
            log.download.retry(chapter.number, attempt, DOWNLOAD_CONFIG.maxRetries);
            await new Promise(r => setTimeout(r, DOWNLOAD_CONFIG.retryDelay * attempt));
            return downloadChapter(novelTitle, chapter, attempt + 1);
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
 * Download all chapters of a novel
 */
export async function downloadNovel(novel, options = {}) {
    const {
        onProgress = null,
        skipExisting = true,
        startFrom = 1
    } = options;

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

    // Get already downloaded chapters
    const downloadedChapters = skipExisting
        ? await storage.getDownloadedChapters(novel.title)
        : [];

    const downloadedSet = new Set(downloadedChapters);

    // Load previous failed chapters to retry
    const previousState = await storage.loadDownloadState(novel.title);
    const previouslyFailed = new Set((previousState?.failedChapters || []).map(c => c.number));

    // Filter chapters to download (not yet downloaded, or previously failed)
    const chaptersToDownload = novel.chapters.filter(ch =>
        ch.number >= startFrom && (!downloadedSet.has(ch.number) || previouslyFailed.has(ch.number))
    );

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

        const result = await downloadChapter(novel.title, chapter);

        if (result.success) {
            results.downloaded++;
            results.totalWordCount += result.wordCount;
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
