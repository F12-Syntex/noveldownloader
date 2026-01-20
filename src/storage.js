/**
 * Storage Module
 * Manages novel data, metadata, and chapter files
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from './logger.js';

const DATA_DIR = 'data';

/**
 * Sanitize a string for use as a directory name
 */
export function sanitizeName(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 100);
}

/**
 * Get the directory path for a novel
 */
export function getNovelDir(novelName) {
    return path.join(DATA_DIR, sanitizeName(novelName));
}

/**
 * Ensure the data directory structure exists
 */
export async function ensureDataDir() {
    await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Get all downloaded novels
 */
export async function getAllDownloads() {
    await ensureDataDir();

    try {
        const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
        const novels = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const metaPath = path.join(DATA_DIR, entry.name, 'meta.json');
            try {
                const metaContent = await fs.readFile(metaPath, 'utf-8');
                const meta = JSON.parse(metaContent);
                novels.push({
                    dirName: entry.name,
                    ...meta
                });
            } catch (err) {
                // Skip directories without valid meta.json
                log.debug(`Skipping directory without valid meta.json: ${entry.name}`);
            }
        }

        return novels;
    } catch (err) {
        log.error('Failed to read downloads directory', { error: err.message });
        return [];
    }
}

/**
 * Get a specific novel by directory name
 */
export async function getNovel(dirName) {
    const metaPath = path.join(DATA_DIR, dirName, 'meta.json');
    try {
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        return JSON.parse(metaContent);
    } catch (err) {
        return null;
    }
}

/**
 * Save novel metadata
 */
export async function saveMetadata(novel) {
    const novelDir = getNovelDir(novel.title);
    await fs.mkdir(novelDir, { recursive: true });

    const metaPath = path.join(novelDir, 'meta.json');
    await fs.writeFile(metaPath, JSON.stringify(novel, null, 2), 'utf-8');

    log.debug(`Saved metadata for: ${novel.title}`);
    return metaPath;
}

/**
 * Update novel metadata (merge with existing)
 */
export async function updateMetadata(novelName, updates) {
    const novelDir = getNovelDir(novelName);
    const metaPath = path.join(novelDir, 'meta.json');

    try {
        const existing = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        const updated = { ...existing, ...updates };
        await fs.writeFile(metaPath, JSON.stringify(updated, null, 2), 'utf-8');
        return updated;
    } catch (err) {
        log.error(`Failed to update metadata for: ${novelName}`, { error: err.message });
        throw err;
    }
}

/**
 * Save a chapter to file
 */
export async function saveChapter(novelName, chapterNum, title, content) {
    const novelDir = getNovelDir(novelName);
    const chaptersDir = path.join(novelDir, 'chapters');
    await fs.mkdir(chaptersDir, { recursive: true });

    const filename = `chapter${chapterNum}.txt`;
    const filepath = path.join(chaptersDir, filename);

    // Format content with title header
    const formattedContent = `${title}\n${'='.repeat(50)}\n\n${content}`;
    await fs.writeFile(filepath, formattedContent, 'utf-8');

    return filepath;
}

/**
 * Check if a chapter exists
 */
export async function chapterExists(novelName, chapterNum) {
    const novelDir = getNovelDir(novelName);
    const filepath = path.join(novelDir, 'chapters', `chapter${chapterNum}.txt`);

    try {
        await fs.access(filepath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get all downloaded chapter numbers for a novel
 */
export async function getDownloadedChapters(novelName) {
    const novelDir = getNovelDir(novelName);
    const chaptersDir = path.join(novelDir, 'chapters');

    try {
        const files = await fs.readdir(chaptersDir);
        const chapterNums = files
            .filter(f => f.startsWith('chapter') && f.endsWith('.txt'))
            .map(f => {
                const match = f.match(/chapter(\d+)\.txt/);
                return match ? parseInt(match[1]) : null;
            })
            .filter(n => n !== null)
            .sort((a, b) => a - b);

        return chapterNums;
    } catch {
        return [];
    }
}

/**
 * Get chapter content
 */
export async function getChapterContent(novelName, chapterNum) {
    const novelDir = getNovelDir(novelName);
    const filepath = path.join(novelDir, 'chapters', `chapter${chapterNum}.txt`);

    try {
        return await fs.readFile(filepath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * Save download state (for resuming downloads)
 */
export async function saveDownloadState(novelName, state) {
    const novelDir = getNovelDir(novelName);
    const statePath = path.join(novelDir, 'download_state.json');
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Load download state
 */
export async function loadDownloadState(novelName) {
    const novelDir = getNovelDir(novelName);
    const statePath = path.join(novelDir, 'download_state.json');

    try {
        const content = await fs.readFile(statePath, 'utf-8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

/**
 * Save cover image
 */
export async function saveCover(novelName, imageBuffer) {
    const novelDir = getNovelDir(novelName);
    await fs.mkdir(novelDir, { recursive: true });

    const coverPath = path.join(novelDir, 'cover.png');
    await fs.writeFile(coverPath, imageBuffer);

    log.debug(`Saved cover for: ${novelName}`);
    return coverPath;
}

/**
 * Get cover image path if exists
 */
export async function getCoverPath(novelName) {
    const novelDir = getNovelDir(novelName);
    const coverPath = path.join(novelDir, 'cover.png');

    try {
        await fs.access(coverPath);
        return coverPath;
    } catch {
        return null;
    }
}

/**
 * Delete a novel and all its data
 */
export async function deleteNovel(novelName) {
    const novelDir = getNovelDir(novelName);

    try {
        await fs.rm(novelDir, { recursive: true, force: true });
        log.info(`Deleted novel: ${novelName}`);
        return true;
    } catch (err) {
        log.error(`Failed to delete novel: ${novelName}`, { error: err.message });
        return false;
    }
}

/**
 * Get download statistics for a novel
 */
export async function getDownloadStats(novelName) {
    const novel = await getNovel(sanitizeName(novelName));
    if (!novel) return null;

    const downloadedChapters = await getDownloadedChapters(novelName);
    const state = await loadDownloadState(novelName);

    return {
        title: novel.title,
        totalChapters: novel.totalChapters || novel.chapters?.length || 0,
        downloadedCount: downloadedChapters.length,
        downloadedChapters,
        failedChapters: state?.failedChapters || [],
        lastUpdated: state?.lastUpdated || null,
        isComplete: downloadedChapters.length === (novel.totalChapters || novel.chapters?.length || 0)
    };
}
