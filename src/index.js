#!/usr/bin/env node

/**
 * Novel Downloader CLI
 * An interactive CLI for downloading novels from NovelFull.net
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { searchNovels, getNovelDetails, supportsSearch, supportsBrowse, getGenres, browseByGenre } from './scraper.js';
import { downloadNovel, retryFailedChapters, getDownloadProgress } from './downloader.js';
import {
    exportToEpub, exportToPdf, exportToDocx, exportToOdt,
    exportToHtml, exportToTxt, exportToRtf, exportToAzw3, exportToMobi,
    listExports, checkPandoc, checkLatex, checkCalibre
} from './exporter.js';
import * as storage from './storage.js';
import { log, setDetailedLogs } from './logger.js';
import { loadSettings, setSetting, getSettings } from './settings.js';
import { manageDependencies } from './dependencies.js';
import {
    loadSources,
    getEnabledSources,
    getActiveSource,
    setActiveSource,
    setSourceEnabled
} from './sourceManager.js';

// ASCII Art Banner
function getBanner() {
    const activeSource = getActiveSource();
    const sourceName = activeSource ? activeSource.name : 'No source selected';
    return `
${chalk.cyan('╔════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('NOVEL DOWNLOADER')}                                        ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('Download & Export novels from multiple sources')}            ${chalk.cyan('║')}
${chalk.cyan('╠════════════════════════════════════════════════════════════╣')}
${chalk.cyan('║')}  ${chalk.yellow('Source:')} ${chalk.white(sourceName.padEnd(47))} ${chalk.cyan('║')}
${chalk.cyan('╚════════════════════════════════════════════════════════════╝')}
`;
}

/**
 * Main menu options
 */
async function mainMenu() {
    console.clear();
    console.log(getBanner());

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
                { name: 'Download New Novel', value: 'download' },
                { name: 'View Downloads', value: 'downloads' },
                { name: 'Export Novel', value: 'export' },
                new inquirer.Separator(),
                { name: 'Sources', value: 'sources' },
                { name: 'Dependencies', value: 'dependencies' },
                { name: 'Settings', value: 'settings' },
                { name: 'Exit', value: 'exit' }
            ],
            loop: false
        }
    ]);

    return action;
}

/**
 * Find novel by text search
 */
async function findNovelBySearch() {
    const { query } = await inquirer.prompt([
        {
            type: 'input',
            name: 'query',
            message: 'Enter novel name to search:',
            validate: (input) => input.trim().length > 0 || 'Please enter a search term'
        }
    ]);

    console.log(chalk.gray('\nSearching...'));

    const results = await searchNovels(query.trim());

    if (results.length === 0) {
        console.log(chalk.yellow('\nNo novels found. Try a different search term.'));
        return null;
    }

    const { selectedNovel } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedNovel',
            message: `Found ${results.length} novels. Select one:`,
            choices: [
                ...results.map((novel) => ({
                    name: `${novel.title} ${chalk.gray(`by ${novel.author}`)}`,
                    value: novel
                })),
                new inquirer.Separator(),
                { name: chalk.gray('← Cancel'), value: null }
            ],
            pageSize: 15,
            loop: false
        }
    ]);

    return selectedNovel;
}

/**
 * Find novel by browsing genres
 */
async function findNovelByBrowse() {
    const genres = getGenres();

    if (genres.length === 0) {
        console.log(chalk.yellow('No genres available for browsing.'));
        return null;
    }

    const { selectedGenre } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedGenre',
            message: 'Select a genre to browse:',
            choices: [
                ...genres.map((g) => ({
                    name: g.name,
                    value: g
                })),
                new inquirer.Separator(),
                { name: chalk.gray('← Cancel'), value: null }
            ],
            pageSize: 15,
            loop: false
        }
    ]);

    if (!selectedGenre) return null;

    console.log(chalk.gray(`\nBrowsing ${selectedGenre.name}...`));

    const novels = await browseByGenre(selectedGenre.url, 1);

    if (novels.length === 0) {
        console.log(chalk.yellow('\nNo novels found in this genre.'));
        return null;
    }

    const { selectedNovel } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedNovel',
            message: `Found ${novels.length} novels. Select one:`,
            choices: [
                ...novels.map((novel) => ({
                    name: `${novel.title} ${chalk.gray(`by ${novel.author || 'Unknown'}`)}`,
                    value: novel
                })),
                new inquirer.Separator(),
                { name: chalk.gray('← Cancel'), value: null }
            ],
            pageSize: 15,
            loop: false
        }
    ]);

    return selectedNovel;
}

/**
 * Find novel by direct URL
 */
async function findNovelByUrl() {
    const activeSource = getActiveSource();

    const { novelUrl } = await inquirer.prompt([
        {
            type: 'input',
            name: 'novelUrl',
            message: `Enter novel URL (e.g., ${activeSource.baseUrl}/book/novel-name):`,
            validate: (input) => {
                if (!input.trim()) return 'Please enter a URL';
                if (!input.includes(activeSource.baseUrl) && !input.startsWith('/')) {
                    return `URL must be from ${activeSource.baseUrl}`;
                }
                return true;
            }
        }
    ]);

    let url = novelUrl.trim();
    if (url.startsWith('/')) {
        url = activeSource.baseUrl + url;
    }

    return { url, title: 'Loading...', author: 'Unknown' };
}

/**
 * Download new novel flow
 */
async function downloadNewNovel() {
    console.clear();
    console.log(chalk.cyan('━━━ Download New Novel ━━━\n'));

    // Check if there's an active source
    const activeSource = getActiveSource();
    if (!activeSource) {
        console.log(chalk.yellow('No source selected. Please select a source first.'));
        await pressEnterToContinue();
        return;
    }

    console.log(chalk.gray(`Source: ${activeSource.name}\n`));

    // Build options based on source capabilities
    const findOptions = [];

    if (supportsSearch()) {
        findOptions.push({ name: 'Search by name', value: 'search' });
    }
    if (supportsBrowse()) {
        findOptions.push({ name: 'Browse by genre', value: 'browse' });
    }
    findOptions.push({ name: 'Enter novel URL directly', value: 'url' });
    findOptions.push(new inquirer.Separator());
    findOptions.push({ name: chalk.gray('← Back'), value: 'back' });

    const { findMethod } = await inquirer.prompt([
        {
            type: 'list',
            name: 'findMethod',
            message: 'How would you like to find a novel?',
            choices: findOptions,
            loop: false
        }
    ]);

    if (findMethod === 'back') return;

    let selectedNovel = null;

    try {
        if (findMethod === 'search') {
            selectedNovel = await findNovelBySearch();
        } else if (findMethod === 'browse') {
            selectedNovel = await findNovelByBrowse();
        } else if (findMethod === 'url') {
            selectedNovel = await findNovelByUrl();
        }

        if (!selectedNovel) return;

        console.log(chalk.gray('\nFetching novel details...'));

        // Get full novel details
        const novelDetails = await getNovelDetails(selectedNovel.url);

        // Display novel info
        console.log(chalk.cyan('\n━━━ Novel Details ━━━'));
        console.log(chalk.white(`Title:    ${novelDetails.title}`));
        console.log(chalk.white(`Author:   ${novelDetails.author}`));
        console.log(chalk.white(`Status:   ${novelDetails.status}`));
        console.log(chalk.white(`Chapters: ${novelDetails.totalChapters}`));
        console.log(chalk.white(`Genres:   ${novelDetails.genres.join(', ')}`));
        if (novelDetails.rating) {
            console.log(chalk.white(`Rating:   ${novelDetails.rating}`));
        }
        if (novelDetails.description) {
            console.log(chalk.gray(`\n${novelDetails.description.substring(0, 300)}...`));
        }

        // Confirm download
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Download ${novelDetails.totalChapters} chapters?`,
                default: true
            }
        ]);

        if (!confirm) return;

        // Start download
        const result = await downloadNovel(novelDetails);

        // Display results
        console.log(chalk.cyan('\n━━━ Download Complete ━━━'));
        console.log(chalk.green(`✓ Downloaded: ${result.downloaded} chapters`));
        if (result.skipped > 0) {
            console.log(chalk.gray(`○ Skipped:    ${result.skipped} (already downloaded)`));
        }
        if (result.failed > 0) {
            console.log(chalk.red(`✗ Failed:     ${result.failed} chapters`));

            const { retry } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'retry',
                    message: 'Would you like to retry failed chapters?',
                    default: true
                }
            ]);

            if (retry) {
                await retryFailedChapters(novelDetails.title);
            }
        }

    } catch (error) {
        console.log(chalk.red(`\nError: ${error.message}`));
        log.error('Download failed', { error: error.message });
    }

    await pressEnterToContinue();
}

/**
 * View downloads
 */
async function viewDownloads() {
    console.clear();
    console.log(chalk.cyan('━━━ Your Downloads ━━━\n'));

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(chalk.gray('No novels downloaded yet.'));
        await pressEnterToContinue();
        return;
    }

    // Get progress for each novel
    const novelList = [];
    for (const novel of downloads) {
        const progress = await getDownloadProgress(novel.title);
        novelList.push({
            ...novel,
            progress
        });
    }

    // Display novels with progress
    for (const novel of novelList) {
        const prog = novel.progress;
        const progressBar = createProgressBar(prog?.percentage || 0, 20);
        const status = prog?.isComplete
            ? chalk.green('✓ Complete')
            : chalk.yellow(`${prog?.downloadedCount || 0}/${prog?.totalChapters || '?'}`);

        console.log(chalk.white.bold(novel.title));
        console.log(chalk.gray(`  Author: ${novel.author || 'Unknown'}`));
        console.log(chalk.gray(`  Status: ${novel.status || 'Unknown'}`));
        console.log(`  Progress: ${progressBar} ${status}`);

        if (prog?.failedChapters?.length > 0) {
            console.log(chalk.red(`  Failed: ${prog.failedChapters.length} chapters`));
        }
        console.log();
    }

    // Options menu
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
                { name: 'Resume incomplete download', value: 'resume' },
                { name: 'Retry failed chapters', value: 'retry' },
                { name: 'Delete a novel', value: 'delete' },
                new inquirer.Separator(),
                { name: chalk.gray('← Back to menu'), value: 'back' }
            ],
            loop: false
        }
    ]);

    if (action === 'back') return;

    // Select a novel for the action
    const { selectedNovel } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedNovel',
            message: 'Select a novel:',
            choices: [
                ...novelList.map(n => ({
                    name: n.title,
                    value: n
                })),
                new inquirer.Separator(),
                { name: chalk.gray('← Cancel'), value: null }
            ],
            loop: false
        }
    ]);

    if (!selectedNovel) return;

    if (action === 'resume') {
        console.log(chalk.gray('\nResuming download...'));

        // Re-fetch novel details to get chapter list
        try {
            const novelDetails = await getNovelDetails(selectedNovel.url);
            await downloadNovel(novelDetails, { skipExisting: true });
        } catch (err) {
            console.log(chalk.red(`Error: ${err.message}`));
        }

    } else if (action === 'retry') {
        await retryFailedChapters(selectedNovel.title);

    } else if (action === 'delete') {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Delete "${selectedNovel.title}" and all downloaded chapters?`,
                default: false
            }
        ]);

        if (confirm) {
            await storage.deleteNovel(selectedNovel.title);
            console.log(chalk.green('\nNovel deleted.'));
        }
    }

    await pressEnterToContinue();
}

/**
 * Export novel flow
 */
async function exportNovel() {
    console.clear();
    console.log(chalk.cyan('━━━ Export Novel ━━━\n'));

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(chalk.gray('No novels downloaded yet. Download a novel first.'));
        await pressEnterToContinue();
        return;
    }

    // Show existing exports
    const existingExports = await listExports();
    if (existingExports.length > 0) {
        console.log(chalk.gray('Existing exports:'));
        existingExports.forEach(exp => {
            console.log(chalk.gray(`  • ${exp.filename} (${exp.format}, ${exp.size})`));
        });
        console.log();
    }

    // Select a novel to export
    const { selectedNovel } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedNovel',
            message: 'Select a novel to export:',
            choices: [
                ...downloads.map(n => {
                    const chapterCount = n.totalChapters || n.chapters?.length || '?';
                    return {
                        name: `${n.title} ${chalk.gray(`(${chapterCount} chapters)`)}`,
                        value: n
                    };
                }),
                new inquirer.Separator(),
                { name: chalk.gray('← Cancel'), value: null }
            ],
            loop: false
        }
    ]);

    if (!selectedNovel) return;

    // Check if there are downloaded chapters
    const downloadedChapters = await storage.getDownloadedChapters(selectedNovel.title);
    if (downloadedChapters.length === 0) {
        console.log(chalk.yellow('\nNo chapters downloaded for this novel yet.'));
        await pressEnterToContinue();
        return;
    }

    // Select export format
    const { format } = await inquirer.prompt([
        {
            type: 'list',
            name: 'format',
            message: 'Select export format:',
            choices: [
                new inquirer.Separator('─── E-Book Formats ───'),
                { name: '📖  EPUB (e-readers, most devices)', value: 'epub' },
                { name: '📱  AZW3 (Kindle modern)', value: 'azw3' },
                { name: '📱  MOBI (Kindle legacy)', value: 'mobi' },
                new inquirer.Separator('─── Document Formats ───'),
                { name: '📄  PDF (print, desktop reading)', value: 'pdf' },
                { name: '📝  DOCX (Microsoft Word)', value: 'docx' },
                { name: '📝  ODT (LibreOffice/OpenDocument)', value: 'odt' },
                { name: '📝  RTF (Rich Text Format)', value: 'rtf' },
                new inquirer.Separator('─── Other Formats ───'),
                { name: '🌐  HTML (web page)', value: 'html' },
                { name: '📃  TXT (plain text)', value: 'txt' },
                new inquirer.Separator(),
                { name: chalk.gray('← Cancel'), value: null }
            ],
            pageSize: 15,
            loop: false
        }
    ]);

    if (!format) return;

    console.log(chalk.gray(`\nExporting ${downloadedChapters.length} chapters...`));

    try {
        const exportFunctions = {
            epub: exportToEpub,
            pdf: exportToPdf,
            docx: exportToDocx,
            odt: exportToOdt,
            html: exportToHtml,
            txt: exportToTxt,
            rtf: exportToRtf,
            azw3: exportToAzw3,
            mobi: exportToMobi
        };

        await exportFunctions[format](selectedNovel.title);
    } catch (error) {
        console.log(chalk.red(`\nExport failed: ${error.message}`));
        log.error('Export failed', { error: error.message, format });
    }

    await pressEnterToContinue();
}

/**
 * Sources management menu
 */
async function manageSources() {
    console.clear();
    console.log(chalk.cyan('━━━ Sources ━━━\n'));

    const sources = await loadSources();

    if (sources.length === 0) {
        console.log(chalk.yellow('No sources found.'));
        console.log(chalk.gray('Add source configurations to the sources/ directory.'));
        await pressEnterToContinue();
        return;
    }

    const activeSource = getActiveSource();

    // Display sources
    console.log(chalk.white('Available sources:\n'));
    for (const source of sources) {
        const isActive = activeSource?.id === source.id;
        const status = source.enabled
            ? (isActive ? chalk.green('● Active') : chalk.blue('○ Enabled'))
            : chalk.gray('○ Disabled');

        console.log(`  ${status}  ${chalk.white.bold(source.name)}`);
        console.log(chalk.gray(`        ${source.baseUrl}`));
        console.log(chalk.gray(`        Version: ${source.version || '1.0.0'}`));
        console.log();
    }

    // Options menu
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
                { name: 'Select active source', value: 'select' },
                { name: 'Enable/Disable source', value: 'toggle' },
                new inquirer.Separator(),
                { name: chalk.gray('← Back to menu'), value: 'back' }
            ],
            loop: false
        }
    ]);

    if (action === 'back') return;

    if (action === 'select') {
        const enabledSources = await getEnabledSources();

        if (enabledSources.length === 0) {
            console.log(chalk.yellow('\nNo enabled sources. Enable a source first.'));
            await pressEnterToContinue();
            return;
        }

        const { selectedSource } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedSource',
                message: 'Select active source:',
                choices: [
                    ...enabledSources.map(s => ({
                        name: `${s.name} ${activeSource?.id === s.id ? chalk.green('(current)') : ''}`,
                        value: s.id
                    })),
                    new inquirer.Separator(),
                    { name: chalk.gray('← Cancel'), value: null }
                ],
                loop: false
            }
        ]);

        if (selectedSource) {
            await setActiveSource(selectedSource);
            console.log(chalk.green(`\nActive source set to: ${selectedSource}`));
        }

    } else if (action === 'toggle') {
        const { selectedSource } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedSource',
                message: 'Select source to enable/disable:',
                choices: [
                    ...sources.map(s => ({
                        name: `${s.name} ${s.enabled ? chalk.green('[enabled]') : chalk.gray('[disabled]')}`,
                        value: s
                    })),
                    new inquirer.Separator(),
                    { name: chalk.gray('← Cancel'), value: null }
                ],
                loop: false
            }
        ]);

        if (selectedSource) {
            const newState = !selectedSource.enabled;
            await setSourceEnabled(selectedSource.id, newState);
            console.log(chalk.green(`\nSource "${selectedSource.name}" ${newState ? 'enabled' : 'disabled'}.`));
        }
    }

    await pressEnterToContinue();
}

/**
 * Settings menu
 */
async function showSettings() {
    console.clear();
    console.log(chalk.cyan('━━━ Settings ━━━\n'));

    const settings = getSettings();

    const { setting } = await inquirer.prompt([
        {
            type: 'list',
            name: 'setting',
            message: 'Configure settings:',
            choices: [
                {
                    name: `Detailed Logs: ${settings.detailedLogs ? chalk.green('ON') : chalk.gray('OFF')}`,
                    value: 'detailedLogs'
                },
                new inquirer.Separator(),
                { name: chalk.gray('← Back'), value: 'back' }
            ],
            loop: false
        }
    ]);

    if (setting === 'back') return;

    if (setting === 'detailedLogs') {
        const newValue = !settings.detailedLogs;
        await setSetting('detailedLogs', newValue);
        setDetailedLogs(newValue);
        console.log(chalk.green(`\nDetailed logs ${newValue ? 'enabled' : 'disabled'}.`));
        await pressEnterToContinue();
    }
}

/**
 * Create a simple ASCII progress bar
 */
function createProgressBar(percentage, width = 20) {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    return `[${bar}] ${percentage}%`;
}

/**
 * Wait for user to press enter
 */
async function pressEnterToContinue() {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(chalk.gray('\nPress Enter to continue...'), () => {
            rl.close();
            resolve();
        });
    });
}

/**
 * Main application loop
 */
async function main() {
    log.info('Application started');

    // Load settings and apply them
    const settings = await loadSettings();
    setDetailedLogs(settings.detailedLogs);

    // Load sources
    const sources = await loadSources();
    if (sources.length === 0) {
        console.log(chalk.yellow('Warning: No sources found in sources/ directory'));
    } else {
        const activeSource = getActiveSource();
        if (activeSource) {
            log.info(`Active source: ${activeSource.name}`);
        }
    }

    // Ensure data directory exists
    await storage.ensureDataDir();

    let running = true;

    while (running) {
        try {
            const action = await mainMenu();

            switch (action) {
                case 'download':
                    await downloadNewNovel();
                    break;
                case 'downloads':
                    await viewDownloads();
                    break;
                case 'export':
                    await exportNovel();
                    break;
                case 'sources':
                    await manageSources();
                    break;
                case 'dependencies':
                    await manageDependencies();
                    await pressEnterToContinue();
                    break;
                case 'settings':
                    await showSettings();
                    break;
                case 'exit':
                    running = false;
                    break;
            }
        } catch (error) {
            if (error.name === 'ExitPromptError') {
                // User pressed Ctrl+C
                running = false;
            } else {
                console.log(chalk.red(`\nUnexpected error: ${error.message}`));
                log.error('Unexpected error', { error: error.message, stack: error.stack });
                await pressEnterToContinue();
            }
        }
    }

    console.log(chalk.cyan('\nGoodbye! Happy reading!\n'));
    log.info('Application exited');
    process.exit(0);
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log(chalk.cyan('\n\nGoodbye! Happy reading!\n'));
    process.exit(0);
});

// Run the application
main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
});
