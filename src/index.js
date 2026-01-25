#!/usr/bin/env node

/**
 * Novel Downloader CLI
 * An interactive CLI for downloading novels from NovelFull.net
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { searchNovels, getNovelDetails } from './scraper.js';
import { downloadNovel, retryFailedChapters, getDownloadProgress } from './downloader.js';
import {
    exportToEpub, exportToPdf, exportToDocx, exportToOdt,
    exportToHtml, exportToTxt, exportToRtf, exportToAzw3, exportToMobi,
    listExports, checkPandoc, checkLatex, checkCalibre
} from './exporter.js';

// Cache for dependency checks (to avoid repeated checks)
let depCache = { pandoc: null, latex: null, calibre: null };
import * as storage from './storage.js';
import { log, setDetailedLogs } from './logger.js';
import { loadSettings, setSetting, getSettings } from './settings.js';
import { manageDependencies } from './dependencies.js';
import {
    loadSources,
    getActiveSource,
    setActiveSource,
    getTerms
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

    const t = getTerms();
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
                { name: `Download New ${t.Item}`, value: 'download' },
                { name: 'View Downloads', value: 'downloads' },
                { name: `Export ${t.Item}`, value: 'export' },
                new inquirer.Separator(),
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
 * Download new novel flow
 */
async function downloadNewNovel() {
    const t = getTerms();
    console.clear();
    console.log(chalk.cyan(`━━━ Download New ${t.Item} ━━━\n`));

    // Check if there's an active source
    const activeSource = getActiveSource();
    if (!activeSource) {
        console.log(chalk.yellow('No source selected. Please select a source in Settings.'));
        await pressEnterToContinue();
        return;
    }

    console.log(chalk.gray(`Searching on: ${activeSource.name}\n`));

    // Get search query
    const { query } = await inquirer.prompt([
        {
            type: 'input',
            name: 'query',
            message: `Search for ${t.item}:`,
            validate: (input) => input.trim().length > 0 || 'Please enter a search term'
        }
    ]);

    console.log(chalk.gray('\nSearching...'));

    try {
        const results = await searchNovels(query.trim());

        if (results.length === 0) {
            console.log(chalk.yellow(`\nNo ${t.items} found. Try a different search term.`));
            await pressEnterToContinue();
            return;
        }

        // Let user select a novel
        const { selectedNovel } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedNovel',
                message: `Found ${results.length} ${t.items}:`,
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

        if (!selectedNovel) return;

        console.log(chalk.gray(`\nFetching ${t.item} details...`));

        // Get full novel details
        const novelDetails = await getNovelDetails(selectedNovel.url);

        // Display novel info
        console.log(chalk.cyan(`\n━━━ ${t.Item} Details ━━━`));
        console.log(chalk.white(`Title:       ${novelDetails.title}`));
        console.log(chalk.white(`Author:      ${novelDetails.author}`));
        console.log(chalk.white(`Status:      ${novelDetails.status}`));
        console.log(chalk.white(`${t.Units}:   ${novelDetails.totalChapters}`));
        console.log(chalk.white(`Genres:      ${novelDetails.genres.join(', ')}`));
        if (novelDetails.rating) {
            console.log(chalk.white(`Rating:      ${novelDetails.rating}`));
        }
        if (novelDetails.description) {
            console.log(chalk.gray(`\n${novelDetails.description.substring(0, 300)}...`));
        }

        // Confirm download
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Download ${novelDetails.totalChapters} ${t.units}?`,
                default: true
            }
        ]);

        if (!confirm) return;

        // Start download
        const result = await downloadNovel(novelDetails);

        // Display results
        console.log(chalk.cyan('\n━━━ Download Complete ━━━'));
        console.log(chalk.green(`✓ Downloaded: ${result.downloaded} ${t.units}`));
        if (result.skipped > 0) {
            console.log(chalk.gray(`○ Skipped:    ${result.skipped} (already downloaded)`));
        }
        if (result.failed > 0) {
            console.log(chalk.red(`✗ Failed:     ${result.failed} ${t.units}`));

            const { retry } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'retry',
                    message: `Retry failed ${t.units}?`,
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
    const t = getTerms();
    console.clear();
    console.log(chalk.cyan('━━━ Your Downloads ━━━\n'));

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(chalk.gray(`No ${t.items} downloaded yet.`));
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
            console.log(chalk.red(`  Failed: ${prog.failedChapters.length} ${t.units}`));
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
                { name: `Retry failed ${t.units}`, value: 'retry' },
                { name: `Delete a ${t.item}`, value: 'delete' },
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
            message: `Select a ${t.item}:`,
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
                message: `Delete "${selectedNovel.title}" and all downloaded ${t.units}?`,
                default: false
            }
        ]);

        if (confirm) {
            await storage.deleteNovel(selectedNovel.title);
            console.log(chalk.green(`\n${t.Item} deleted.`));
        }
    }

    await pressEnterToContinue();
}

/**
 * Export novel flow
 */
async function exportNovel() {
    const t = getTerms();
    console.clear();
    console.log(chalk.cyan(`━━━ Export ${t.Item} ━━━\n`));

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(chalk.gray(`No ${t.items} downloaded yet. Download a ${t.item} first.`));
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
            message: `Select a ${t.item} to export:`,
            choices: [
                ...downloads.map(n => {
                    const chapterCount = n.totalChapters || n.chapters?.length || '?';
                    return {
                        name: `${n.title} ${chalk.gray(`(${chapterCount} ${t.units})`)}`,
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
        console.log(chalk.yellow(`\nNo ${t.units} downloaded for this ${t.item} yet.`));
        await pressEnterToContinue();
        return;
    }

    // Check dependencies for format indicators
    if (depCache.latex === null) {
        depCache.latex = await checkLatex();
    }
    if (depCache.calibre === null) {
        depCache.calibre = await checkCalibre();
    }

    const latexStatus = depCache.latex ? '' : chalk.yellow(' [needs LaTeX]');
    const calibreStatus = depCache.calibre ? '' : chalk.yellow(' [needs Calibre]');

    // Select export format
    const { format } = await inquirer.prompt([
        {
            type: 'list',
            name: 'format',
            message: 'Select export format:',
            choices: [
                new inquirer.Separator('─── E-Book Formats ───'),
                { name: '    EPUB (e-readers, most devices)', value: 'epub' },
                { name: `    AZW3 (Kindle modern)${calibreStatus}`, value: 'azw3' },
                { name: `    MOBI (Kindle legacy)${calibreStatus}`, value: 'mobi' },
                new inquirer.Separator('─── Document Formats ───'),
                { name: `    PDF (print, desktop reading)${latexStatus}`, value: 'pdf' },
                { name: '    DOCX (Microsoft Word)', value: 'docx' },
                { name: '    ODT (LibreOffice/OpenDocument)', value: 'odt' },
                { name: '    RTF (Rich Text Format)', value: 'rtf' },
                new inquirer.Separator('─── Other Formats ───'),
                { name: '    HTML (web page)', value: 'html' },
                { name: '    TXT (plain text)', value: 'txt' },
                new inquirer.Separator(),
                { name: chalk.gray('← Cancel'), value: null }
            ],
            pageSize: 15,
            loop: false
        }
    ]);

    if (!format) return;

    console.log(chalk.gray(`\nExporting ${downloadedChapters.length} ${t.units}...`));

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
 * Source selection (called from settings)
 */
async function selectSource() {
    const sources = await loadSources();

    if (sources.length === 0) {
        console.log(chalk.yellow('\nNo sources found.'));
        console.log(chalk.gray('Add source configurations to the sources/ directory.'));
        return;
    }

    const activeSource = getActiveSource();

    const { selectedSource } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedSource',
            message: 'Select source:',
            choices: [
                ...sources.map(s => ({
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
        const source = sources.find(s => s.id === selectedSource);
        console.log(chalk.green(`\nSource set to: ${source?.name}`));
    }
}

/**
 * Settings menu
 */
async function showSettings() {
    console.clear();
    console.log(chalk.cyan('━━━ Settings ━━━\n'));

    const settings = getSettings();
    const activeSource = getActiveSource();
    const sourceName = activeSource ? activeSource.name : chalk.yellow('None');

    const { setting } = await inquirer.prompt([
        {
            type: 'list',
            name: 'setting',
            message: 'Configure settings:',
            choices: [
                {
                    name: `Source: ${chalk.cyan(sourceName)}`,
                    value: 'source'
                },
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

    if (setting === 'source') {
        await selectSource();
        await pressEnterToContinue();
    } else if (setting === 'detailedLogs') {
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
                case 'dependencies':
                    await manageDependencies();
                    // Clear dependency cache so export menu shows updated status
                    depCache = { pandoc: null, latex: null, calibre: null };
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
