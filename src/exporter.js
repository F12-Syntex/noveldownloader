/**
 * Exporter Module
 * Export novels to EPUB and PDF formats using Pandoc
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as storage from './storage.js';
import { log } from './logger.js';
import chalk from 'chalk';

const execAsync = promisify(exec);
const EXPORT_DIR = 'exports';
const TEMP_DIR = 'temp';

/**
 * Update a single line in the console
 */
function updateLine(text) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(text);
}

/**
 * Ensure directories exist
 */
async function ensureExportDir() {
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
}

/**
 * Generate a safe filename
 */
function safeFilename(title) {
    return title
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 100);
}

/**
 * Check if pandoc is installed
 */
async function checkPandoc() {
    try {
        await execAsync('pandoc --version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Read all chapters for a novel
 */
async function loadAllChapters(novelName, chapterList) {
    const chapters = [];

    for (const chapterInfo of chapterList) {
        const content = await storage.getChapterContent(novelName, chapterInfo.number);
        if (content) {
            const lines = content.split('\n');
            const title = lines[0] || chapterInfo.title;
            const body = lines.slice(2).join('\n').trim();

            chapters.push({
                number: chapterInfo.number,
                title: title,
                content: body
            });
        }
    }

    return chapters.sort((a, b) => a.number - b.number);
}

/**
 * Generate markdown content for pandoc
 */
function generateMarkdown(novel, chapters) {
    const lines = [];

    // YAML metadata block
    lines.push('---');
    lines.push(`title: "${novel.title.replace(/"/g, '\\"')}"`);
    lines.push(`author: "${(novel.author || 'Unknown').replace(/"/g, '\\"')}"`);
    lines.push(`subject: "${novel.genres?.join(', ') || 'Fiction'}"`);
    lines.push(`description: "${(novel.description || '').substring(0, 500).replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
    lines.push('toc: true');
    lines.push('toc-depth: 1');
    lines.push('---');
    lines.push('');

    // Chapters
    for (const chapter of chapters) {
        // Chapter heading (# for h1 - will appear in TOC)
        lines.push(`# ${chapter.title}`);
        lines.push('');

        // Chapter content - preserve paragraphs
        const paragraphs = chapter.content.split(/\n\n+/);
        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (trimmed) {
                lines.push(trimmed);
                lines.push('');
            }
        }

        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Export novel to EPUB format using Pandoc
 */
export async function exportToEpub(novelName) {
    await ensureExportDir();

    // Check pandoc
    if (!await checkPandoc()) {
        throw new Error('Pandoc is not installed. Please install it from https://pandoc.org/installing.html');
    }

    const novel = await storage.getNovel(storage.sanitizeName(novelName));
    if (!novel) {
        throw new Error(`Novel not found: ${novelName}`);
    }

    log.export.start(novel.title, 'EPUB');
    console.log(chalk.cyan(`Exporting "${novel.title}" to EPUB...`));

    const downloadedChapterNums = await storage.getDownloadedChapters(novelName);
    if (downloadedChapterNums.length === 0) {
        throw new Error('No chapters downloaded for this novel');
    }

    updateLine(chalk.gray('Loading chapters...'));

    const chapterInfoList = downloadedChapterNums.map(num => {
        const chInfo = novel.chapters?.find(ch => ch.number === num);
        return { number: num, title: chInfo?.title || `Chapter ${num}` };
    });

    const chapters = await loadAllChapters(novelName, chapterInfoList);

    updateLine(chalk.gray('Generating markdown...'));

    // Generate markdown
    const markdown = generateMarkdown(novel, chapters);
    const safeName = safeFilename(novel.title);
    const mdPath = path.join(TEMP_DIR, `${safeName}.md`);
    const outputPath = path.join(EXPORT_DIR, `${safeName}.epub`);

    await fs.writeFile(mdPath, markdown, 'utf-8');

    // Check for cover image
    const coverPath = await storage.getCoverPath(novelName);
    let coverArg = '';
    if (coverPath) {
        try {
            await fs.access(coverPath);
            coverArg = `--epub-cover-image="${coverPath}"`;
        } catch {
            // No cover
        }
    }

    updateLine(chalk.gray('Running pandoc...'));

    try {
        const cmd = `pandoc "${mdPath}" -o "${outputPath}" --toc --toc-depth=1 ${coverArg} --metadata title="${novel.title.replace(/"/g, '\\"')}" --metadata author="${(novel.author || 'Unknown').replace(/"/g, '\\"')}"`;

        await execAsync(cmd);

        // Cleanup temp file
        await fs.unlink(mdPath).catch(() => {});

        updateLine('');
        console.log();

        const absolutePath = path.resolve(outputPath);
        const stats = await fs.stat(outputPath);
        log.export.complete(novel.title, 'EPUB', absolutePath);

        console.log(chalk.green(`EPUB created: ${safeName}.epub`));
        console.log(chalk.gray(`${chapters.length} chapters | ${formatFileSize(stats.size)} | ${absolutePath}`));

        return absolutePath;
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'EPUB', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * Export novel to PDF format using Pandoc
 */
export async function exportToPdf(novelName) {
    await ensureExportDir();

    // Check pandoc
    if (!await checkPandoc()) {
        throw new Error('Pandoc is not installed. Please install it from https://pandoc.org/installing.html');
    }

    const novel = await storage.getNovel(storage.sanitizeName(novelName));
    if (!novel) {
        throw new Error(`Novel not found: ${novelName}`);
    }

    log.export.start(novel.title, 'PDF');
    console.log(chalk.cyan(`Exporting "${novel.title}" to PDF...`));

    const downloadedChapterNums = await storage.getDownloadedChapters(novelName);
    if (downloadedChapterNums.length === 0) {
        throw new Error('No chapters downloaded for this novel');
    }

    updateLine(chalk.gray('Loading chapters...'));

    const chapterInfoList = downloadedChapterNums.map(num => {
        const chInfo = novel.chapters?.find(ch => ch.number === num);
        return { number: num, title: chInfo?.title || `Chapter ${num}` };
    });

    const chapters = await loadAllChapters(novelName, chapterInfoList);

    updateLine(chalk.gray('Generating markdown...'));

    // Generate markdown
    const markdown = generateMarkdown(novel, chapters);
    const safeName = safeFilename(novel.title);
    const mdPath = path.join(TEMP_DIR, `${safeName}.md`);
    const outputPath = path.join(EXPORT_DIR, `${safeName}.pdf`);

    await fs.writeFile(mdPath, markdown, 'utf-8');

    updateLine(chalk.gray('Running pandoc...'));

    try {
        // PDF generation with pandoc
        // Using default PDF engine (pdflatex, or specify with --pdf-engine)
        const cmd = `pandoc "${mdPath}" -o "${outputPath}" --toc --toc-depth=1 --pdf-engine=xelatex -V geometry:margin=1in -V fontsize=11pt -V documentclass=book -V toc-title="Table of Contents"`;

        await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer for large novels

        // Cleanup temp file
        await fs.unlink(mdPath).catch(() => {});

        updateLine('');
        console.log();

        const absolutePath = path.resolve(outputPath);
        const stats = await fs.stat(outputPath);
        log.export.complete(novel.title, 'PDF', absolutePath);

        console.log(chalk.green(`PDF created: ${safeName}.pdf`));
        console.log(chalk.gray(`${chapters.length} chapters | ${formatFileSize(stats.size)} | ${absolutePath}`));

        return absolutePath;
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        updateLine('');
        console.log();

        // Check if it's a LaTeX engine issue
        if (err.message.includes('xelatex') || err.message.includes('pdflatex')) {
            log.export.failed(novel.title, 'PDF', err);
            throw new Error('PDF generation requires LaTeX. Install TeX Live or MiKTeX, or use EPUB export instead.');
        }

        log.export.failed(novel.title, 'PDF', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * List available exports
 */
export async function listExports() {
    await ensureExportDir();

    try {
        const files = await fs.readdir(EXPORT_DIR);
        const exports = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (ext === '.epub' || ext === '.pdf') {
                const filePath = path.join(EXPORT_DIR, file);
                const stats = await fs.stat(filePath);
                exports.push({
                    filename: file,
                    format: ext.substring(1).toUpperCase(),
                    size: formatFileSize(stats.size),
                    created: stats.mtime
                });
            }
        }

        return exports;
    } catch {
        return [];
    }
}

/**
 * Format file size in human readable form
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
