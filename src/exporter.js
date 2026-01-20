/**
 * Exporter Module
 * Export novels to multiple formats using Pandoc
 * Supported: EPUB, PDF, DOCX, ODT, HTML, TXT, RTF, AZW3/MOBI
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as storage from './storage.js';
import { log } from './logger.js';
import { getSetting, resolvePath } from './settings.js';
import chalk from 'chalk';

const execAsync = promisify(exec);

/**
 * Get export directory from settings (resolved with base path)
 */
function getExportDir() {
    return resolvePath(getSetting('exportPath') || 'exports');
}

/**
 * Get temp directory from settings (resolved with base path)
 */
function getTempDir() {
    return resolvePath(getSetting('tempPath') || 'temp');
}

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
    await fs.mkdir(getExportDir(), { recursive: true });
    await fs.mkdir(getTempDir(), { recursive: true });
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
export async function checkPandoc() {
    try {
        await execAsync('pandoc --version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if LaTeX (xelatex) is installed
 */
export async function checkLatex() {
    try {
        await execAsync('xelatex --version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if Calibre's ebook-convert is installed (for MOBI/AZW3)
 */
export async function checkCalibre() {
    try {
        await execAsync('ebook-convert --version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Prepare novel data for export (common setup)
 */
async function prepareNovelForExport(novelName, format) {
    await ensureExportDir();

    if (!await checkPandoc()) {
        throw new Error('Pandoc is not installed. Run "Dependencies" from main menu to install.');
    }

    const novel = await storage.getNovel(storage.sanitizeName(novelName));
    if (!novel) {
        throw new Error(`Novel not found: ${novelName}`);
    }

    log.export.start(novel.title, format);
    console.log(chalk.cyan(`Exporting "${novel.title}" to ${format}...`));

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

    const markdown = generateMarkdown(novel, chapters);
    const safeName = safeFilename(novel.title);
    const mdPath = path.join(getTempDir(), `${safeName}.md`);

    await fs.writeFile(mdPath, markdown, 'utf-8');

    return { novel, chapters, markdown, safeName, mdPath };
}

/**
 * Finalize export (common cleanup and messaging)
 */
async function finalizeExport(novel, chapters, outputPath, format, tempFiles = []) {
    // Cleanup temp files
    for (const file of tempFiles) {
        await fs.unlink(file).catch(() => {});
    }

    updateLine('');
    console.log();

    const absolutePath = path.resolve(outputPath);
    const stats = await fs.stat(outputPath);
    log.export.complete(novel.title, format, absolutePath);

    const safeName = path.basename(outputPath);
    console.log(chalk.green(`${format} created: ${safeName}`));
    console.log(chalk.gray(`${chapters.length} chapters | ${formatFileSize(stats.size)} | ${absolutePath}`));

    return absolutePath;
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
    const mdPath = path.join(getTempDir(), `${safeName}.md`);
    const outputPath = path.join(getExportDir(), `${safeName}.epub`);

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
    const mdPath = path.join(getTempDir(), `${safeName}.md`);
    const outputPath = path.join(getExportDir(), `${safeName}.pdf`);

    await fs.writeFile(mdPath, markdown, 'utf-8');

    updateLine(chalk.gray('Running pandoc...'));

    // Create a LaTeX header file for CJK support
    const latexHeader = `\\usepackage{xeCJK}
\\setCJKmainfont{Microsoft YaHei}
\\setCJKsansfont{Microsoft YaHei}
\\setCJKmonofont{Microsoft YaHei}
`;
    const headerPath = path.join(getTempDir(), `${safeName}_header.tex`);
    await fs.writeFile(headerPath, latexHeader, 'utf-8');

    try {
        // PDF generation with pandoc using XeLaTeX for proper Unicode/CJK support
        // Note: Requires MiKTeX or TeX Live with xelatex installed

        const cmd = [
            `pandoc "${mdPath}" -o "${outputPath}"`,
            '--toc --toc-depth=1',
            '--pdf-engine=xelatex',
            `-H "${headerPath}"`,
            '-V geometry:margin=1in',
            '-V fontsize=11pt',
            '-V documentclass=book',
            '-V toc-title="Table of Contents"',
            '-V mainfont="Segoe UI"',
            '-V monofont="Consolas"',
            '-V colorlinks=true',
            '-V linkcolor=black',
            '-V toccolor=black'
        ].join(' ');

        await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer for large novels

        // Cleanup header file
        await fs.unlink(headerPath).catch(() => {});

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
        await fs.unlink(headerPath).catch(() => {});
        updateLine('');
        console.log();

        // Check if it's a LaTeX engine issue
        if (err.message.includes('xelatex') || err.message.includes('pdflatex') || err.message.includes('xeCJK')) {
            log.export.failed(novel.title, 'PDF', err);
            throw new Error('PDF generation requires LaTeX with CJK support. Install MiKTeX and let it auto-install packages, or use EPUB export instead.');
        }

        log.export.failed(novel.title, 'PDF', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * Export novel to DOCX format (Microsoft Word)
 */
export async function exportToDocx(novelName) {
    const { novel, chapters, safeName, mdPath } = await prepareNovelForExport(novelName, 'DOCX');
    const outputPath = path.join(getExportDir(), `${safeName}.docx`);

    updateLine(chalk.gray('Running pandoc...'));

    try {
        const cmd = `pandoc "${mdPath}" -o "${outputPath}" --toc --toc-depth=1`;
        await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
        return await finalizeExport(novel, chapters, outputPath, 'DOCX', [mdPath]);
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'DOCX', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * Export novel to ODT format (OpenDocument/LibreOffice)
 */
export async function exportToOdt(novelName) {
    const { novel, chapters, safeName, mdPath } = await prepareNovelForExport(novelName, 'ODT');
    const outputPath = path.join(getExportDir(), `${safeName}.odt`);

    updateLine(chalk.gray('Running pandoc...'));

    try {
        const cmd = `pandoc "${mdPath}" -o "${outputPath}" --toc --toc-depth=1`;
        await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
        return await finalizeExport(novel, chapters, outputPath, 'ODT', [mdPath]);
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'ODT', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * Export novel to HTML format (standalone web page)
 */
export async function exportToHtml(novelName) {
    const { novel, chapters, safeName, mdPath } = await prepareNovelForExport(novelName, 'HTML');
    const outputPath = path.join(getExportDir(), `${safeName}.html`);

    updateLine(chalk.gray('Running pandoc...'));

    try {
        const cmd = [
            `pandoc "${mdPath}" -o "${outputPath}"`,
            '--standalone',
            '--toc --toc-depth=1',
            `--metadata title="${novel.title.replace(/"/g, '\\"')}"`,
            '--css=https://cdn.simplecss.org/simple.min.css',
            '-V lang=en'
        ].join(' ');

        await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
        return await finalizeExport(novel, chapters, outputPath, 'HTML', [mdPath]);
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'HTML', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * Export novel to TXT format (plain text)
 */
export async function exportToTxt(novelName) {
    const { novel, chapters, safeName, mdPath } = await prepareNovelForExport(novelName, 'TXT');
    const outputPath = path.join(getExportDir(), `${safeName}.txt`);

    updateLine(chalk.gray('Running pandoc...'));

    try {
        const cmd = `pandoc "${mdPath}" -o "${outputPath}" -t plain --wrap=auto`;
        await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
        return await finalizeExport(novel, chapters, outputPath, 'TXT', [mdPath]);
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'TXT', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * Export novel to RTF format (Rich Text Format)
 */
export async function exportToRtf(novelName) {
    const { novel, chapters, safeName, mdPath } = await prepareNovelForExport(novelName, 'RTF');
    const outputPath = path.join(getExportDir(), `${safeName}.rtf`);

    updateLine(chalk.gray('Running pandoc...'));

    try {
        const cmd = `pandoc "${mdPath}" -o "${outputPath}" --standalone`;
        await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
        return await finalizeExport(novel, chapters, outputPath, 'RTF', [mdPath]);
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'RTF', err);
        throw new Error(`Pandoc failed: ${err.message}`);
    }
}

/**
 * Export novel to AZW3 format (Kindle) - requires Calibre
 */
export async function exportToAzw3(novelName) {
    // First create EPUB, then convert to AZW3
    if (!await checkCalibre()) {
        throw new Error('Calibre is not installed. Run "Dependencies" from main menu to install.');
    }

    const { novel, chapters, safeName, mdPath } = await prepareNovelForExport(novelName, 'AZW3');
    const epubPath = path.join(getTempDir(), `${safeName}.epub`);
    const outputPath = path.join(getExportDir(), `${safeName}.azw3`);

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

    updateLine(chalk.gray('Creating EPUB...'));

    try {
        // First create EPUB
        const epubCmd = `pandoc "${mdPath}" -o "${epubPath}" --toc --toc-depth=1 ${coverArg}`;
        await execAsync(epubCmd, { maxBuffer: 50 * 1024 * 1024 });

        updateLine(chalk.gray('Converting to AZW3...'));

        // Then convert to AZW3 using Calibre
        const convertCmd = `ebook-convert "${epubPath}" "${outputPath}"`;
        await execAsync(convertCmd, { maxBuffer: 50 * 1024 * 1024 });

        return await finalizeExport(novel, chapters, outputPath, 'AZW3', [mdPath, epubPath]);
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        await fs.unlink(epubPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'AZW3', err);
        throw new Error(`Export failed: ${err.message}`);
    }
}

/**
 * Export novel to MOBI format (Kindle legacy) - requires Calibre
 */
export async function exportToMobi(novelName) {
    // First create EPUB, then convert to MOBI
    if (!await checkCalibre()) {
        throw new Error('Calibre is not installed. Run "Dependencies" from main menu to install.');
    }

    const { novel, chapters, safeName, mdPath } = await prepareNovelForExport(novelName, 'MOBI');
    const epubPath = path.join(getTempDir(), `${safeName}.epub`);
    const outputPath = path.join(getExportDir(), `${safeName}.mobi`);

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

    updateLine(chalk.gray('Creating EPUB...'));

    try {
        // First create EPUB
        const epubCmd = `pandoc "${mdPath}" -o "${epubPath}" --toc --toc-depth=1 ${coverArg}`;
        await execAsync(epubCmd, { maxBuffer: 50 * 1024 * 1024 });

        updateLine(chalk.gray('Converting to MOBI...'));

        // Then convert to MOBI using Calibre
        const convertCmd = `ebook-convert "${epubPath}" "${outputPath}"`;
        await execAsync(convertCmd, { maxBuffer: 50 * 1024 * 1024 });

        return await finalizeExport(novel, chapters, outputPath, 'MOBI', [mdPath, epubPath]);
    } catch (err) {
        await fs.unlink(mdPath).catch(() => {});
        await fs.unlink(epubPath).catch(() => {});
        updateLine('');
        console.log();
        log.export.failed(novel.title, 'MOBI', err);
        throw new Error(`Export failed: ${err.message}`);
    }
}

/**
 * List available exports
 */
export async function listExports() {
    await ensureExportDir();

    try {
        const files = await fs.readdir(getExportDir());
        const exports = [];

        const supportedFormats = ['.epub', '.pdf', '.docx', '.odt', '.html', '.txt', '.rtf', '.azw3', '.mobi'];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (supportedFormats.includes(ext)) {
                const filePath = path.join(getExportDir(), file);
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
