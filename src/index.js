#!/usr/bin/env node

/**
 * Novel Downloader CLI
 * An interactive CLI for downloading novels from multiple sources
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

// ============================================================================
// Navigation System
// ============================================================================

// Navigation history stack - stores screens we came FROM (not current screen)
const navHistory = [];

// Navigation constants
const NAV = {
    BACK: Symbol('back'),
    HOME: Symbol('home'),
    EXIT: Symbol('exit'),
    STAY: Symbol('stay'),
};

/**
 * Push a screen to history (call when navigating AWAY from a screen)
 */
function pushHistory(screen) {
    navHistory.push(screen);
}

/**
 * Pop and return previous screen from history
 */
function popHistory() {
    return navHistory.pop();
}

/**
 * Clear navigation history
 */
function clearHistory() {
    navHistory.length = 0;
}

/**
 * Get back choice for menus
 */
function getBackChoice(label = '← Back') {
    return { name: chalk.gray(label), value: NAV.BACK };
}

// ============================================================================
// Cache & State
// ============================================================================

// Cache for dependency checks
let depCache = { pandoc: null, latex: null, calibre: null };

// ============================================================================
// UI Helpers
// ============================================================================

/**
 * ASCII Art Banner
 */
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

// ============================================================================
// Screens
// ============================================================================

/**
 * Main menu screen
 */
async function mainMenuScreen() {
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
                { name: 'Exit', value: NAV.EXIT }
            ],
            loop: false
        }
    ]);

    return action;
}

/**
 * Download new novel screen
 */
async function downloadScreen() {
    const t = getTerms();
    console.clear();
    console.log(chalk.cyan(`━━━ Download New ${t.Item} ━━━\n`));

    // Check if there's an active source
    const activeSource = getActiveSource();
    if (!activeSource) {
        console.log(chalk.yellow('No source selected. Please select a source in Settings.'));
        await pressEnterToContinue();
        return NAV.BACK;
    }

    console.log(chalk.gray(`Searching on: ${activeSource.name}\n`));

    // Get search query with back option
    const { query } = await inquirer.prompt([
        {
            type: 'input',
            name: 'query',
            message: `Search for ${t.item} (or 'back' to go back):`,
            validate: (input) => {
                if (input.trim().toLowerCase() === 'back') return true;
                return input.trim().length > 0 || 'Please enter a search term';
            }
        }
    ]);

    if (query.trim().toLowerCase() === 'back') {
        return NAV.BACK;
    }

    console.log(chalk.gray('\nSearching...'));

    try {
        const results = await searchNovels(query.trim());

        if (results.length === 0) {
            console.log(chalk.yellow(`\nNo ${t.items} found. Try a different search term.`));
            await pressEnterToContinue();
            return NAV.STAY;
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
                    getBackChoice('← Back to search')
                ],
                pageSize: 15,
                loop: false
            }
        ]);

        if (selectedNovel === NAV.BACK) {
            return NAV.STAY;
        }

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
        const { confirmAction } = await inquirer.prompt([
            {
                type: 'list',
                name: 'confirmAction',
                message: `Download ${novelDetails.totalChapters} ${t.units}?`,
                choices: [
                    { name: 'Yes, download', value: 'yes' },
                    { name: 'No, go back', value: NAV.BACK }
                ],
                loop: false
            }
        ]);

        if (confirmAction === NAV.BACK) {
            return NAV.STAY;
        }

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
    return NAV.BACK;
}

/**
 * View downloads screen
 */
async function downloadsScreen() {
    const t = getTerms();
    console.clear();
    console.log(chalk.cyan('━━━ Your Downloads ━━━\n'));

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(chalk.gray(`No ${t.items} downloaded yet.`));
        await pressEnterToContinue();
        return NAV.BACK;
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
                getBackChoice()
            ],
            loop: false
        }
    ]);

    if (action === NAV.BACK) return NAV.BACK;

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
                getBackChoice('← Cancel')
            ],
            loop: false
        }
    ]);

    if (selectedNovel === NAV.BACK) return NAV.STAY;

    if (action === 'resume') {
        console.log(chalk.gray('\nResuming download...'));

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
                type: 'list',
                name: 'confirm',
                message: `Delete "${selectedNovel.title}" and all downloaded ${t.units}?`,
                choices: [
                    { name: 'Yes, delete', value: true },
                    { name: 'No, cancel', value: false }
                ],
                loop: false
            }
        ]);

        if (confirm) {
            await storage.deleteNovel(selectedNovel.title);
            console.log(chalk.green(`\n${t.Item} deleted.`));
        }
    }

    await pressEnterToContinue();
    return NAV.STAY;
}

/**
 * Export novel screen
 */
async function exportScreen() {
    const t = getTerms();
    console.clear();
    console.log(chalk.cyan(`━━━ Export ${t.Item} ━━━\n`));

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(chalk.gray(`No ${t.items} downloaded yet. Download a ${t.item} first.`));
        await pressEnterToContinue();
        return NAV.BACK;
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
                getBackChoice()
            ],
            loop: false
        }
    ]);

    if (selectedNovel === NAV.BACK) return NAV.BACK;

    // Check if there are downloaded chapters
    const downloadedChapters = await storage.getDownloadedChapters(selectedNovel.title);
    if (downloadedChapters.length === 0) {
        console.log(chalk.yellow(`\nNo ${t.units} downloaded for this ${t.item} yet.`));
        await pressEnterToContinue();
        return NAV.STAY;
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
                getBackChoice()
            ],
            pageSize: 15,
            loop: false
        }
    ]);

    if (format === NAV.BACK) return NAV.STAY;

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
    return NAV.STAY;
}

/**
 * Dependencies screen
 */
async function dependenciesScreen() {
    await manageDependencies();
    // Clear dependency cache so export menu shows updated status
    depCache = { pandoc: null, latex: null, calibre: null };
    await pressEnterToContinue();
    return NAV.BACK;
}

/**
 * Settings screen
 */
async function settingsScreen() {
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
                getBackChoice()
            ],
            loop: false
        }
    ]);

    if (setting === NAV.BACK) return NAV.BACK;

    if (setting === 'source') {
        return 'selectSource';
    } else if (setting === 'detailedLogs') {
        const newValue = !settings.detailedLogs;
        await setSetting('detailedLogs', newValue);
        setDetailedLogs(newValue);
        console.log(chalk.green(`\nDetailed logs ${newValue ? 'enabled' : 'disabled'}.`));
        await pressEnterToContinue();
    }

    return NAV.STAY;
}

/**
 * Source selection screen
 */
async function selectSourceScreen() {
    console.clear();
    console.log(chalk.cyan('━━━ Select Source ━━━\n'));

    const sources = await loadSources();

    if (sources.length === 0) {
        console.log(chalk.yellow('No sources found.'));
        console.log(chalk.gray('Add source configurations to the sources/ directory.'));
        await pressEnterToContinue();
        return NAV.BACK;
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
                getBackChoice()
            ],
            loop: false
        }
    ]);

    if (selectedSource === NAV.BACK) return NAV.BACK;

    await setActiveSource(selectedSource);
    const source = sources.find(s => s.id === selectedSource);
    console.log(chalk.green(`\nSource set to: ${source?.name}`));
    await pressEnterToContinue();

    return NAV.BACK;
}

// ============================================================================
// Screen Registry
// ============================================================================

const screens = {
    main: mainMenuScreen,
    download: downloadScreen,
    downloads: downloadsScreen,
    export: exportScreen,
    dependencies: dependenciesScreen,
    settings: settingsScreen,
    selectSource: selectSourceScreen,
};

// ============================================================================
// Main Application Loop
// ============================================================================

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

    let currentScreen = 'main';

    while (currentScreen) {
        try {
            const screenFn = screens[currentScreen];

            if (!screenFn) {
                console.log(chalk.red(`Unknown screen: ${currentScreen}`));
                currentScreen = 'main';
                continue;
            }

            // Run the screen
            const result = await screenFn();

            // Handle navigation based on result
            if (result === NAV.BACK) {
                // Go back to previous screen
                const prev = popHistory();
                currentScreen = prev || 'main';
            } else if (result === NAV.EXIT) {
                // Exit the application
                currentScreen = null;
            } else if (result === NAV.STAY) {
                // Stay on current screen (re-run it) - don't change anything
            } else if (result === NAV.HOME) {
                // Go directly to main menu
                clearHistory();
                currentScreen = 'main';
            } else if (typeof result === 'string') {
                // Navigate to a new screen - push current screen to history first
                if (currentScreen !== 'main') {
                    pushHistory(currentScreen);
                }
                currentScreen = result;
            }

        } catch (error) {
            if (error.name === 'ExitPromptError') {
                // User pressed Ctrl+C - go back or exit
                const prev = popHistory();
                currentScreen = prev || null;
            } else {
                console.log(chalk.red(`\nUnexpected error: ${error.message}`));
                log.error('Unexpected error', { error: error.message, stack: error.stack });
                await pressEnterToContinue();
                currentScreen = 'main';
                clearHistory();
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
