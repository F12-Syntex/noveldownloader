#!/usr/bin/env node

/**
 * Novel/Manga Downloader CLI
 * An interactive CLI for downloading content from multiple sources
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { searchNovels, getNovelDetails, supportsSearch, supportsBrowse, getGenres, browseByGenre, isMangaSource } from './scraper.js';
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
import * as ui from './ui.js';

/**
 * Main menu
 */
async function mainMenu() {
    console.clear();
    console.log(ui.getBanner());

    const contentLabel = ui.getContentLabel(true);
    const activeSource = getActiveSource();

    const choices = [
        ui.menuChoice(`Download New ${contentLabel}`, 'download', `Find and download ${ui.getContentLabel()}`),
        ui.menuChoice('View Downloads', 'downloads', 'Manage downloaded content'),
        ui.menuChoice(`Export ${contentLabel}`, 'export', 'Convert to EPUB, PDF, etc.'),
        new inquirer.Separator(ui.theme.muted('─'.repeat(40))),
        ui.menuChoice('Sources', 'sources', activeSource ? activeSource.name : 'Configure'),
        ui.menuChoice('Dependencies', 'dependencies', 'Check required tools'),
        ui.menuChoice('Settings', 'settings', 'Configure options'),
        new inquirer.Separator(),
        { name: ui.theme.muted('Exit'), value: 'exit' }
    ];

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices,
        ...ui.promptConfig()
    }]);

    return action;
}

/**
 * Find content by text search
 */
async function findBySearch() {
    const contentLabel = ui.getContentLabel();

    const { query } = await inquirer.prompt([{
        type: 'input',
        name: 'query',
        message: `Search for ${contentLabel}:`,
        validate: input => input.trim().length > 0 || 'Please enter a search term'
    }]);

    console.log(ui.loadingText('Searching...'));

    const results = await searchNovels(query.trim());

    if (results.length === 0) {
        console.log(ui.warning(`No ${ui.getContentLabelPlural()} found. Try a different search term.`));
        return null;
    }

    const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Found ${ui.theme.highlight(results.length)} results:`,
        choices: [
            ...results.map(item => ({
                name: `${item.title} ${ui.theme.muted(`by ${item.author || 'Unknown'}`)}`,
                value: item
            })),
            new inquirer.Separator(),
            ui.backChoice('Cancel')
        ],
        ...ui.promptConfig({ pageSize: 15 })
    }]);

    return selected;
}

/**
 * Find content by browsing genres
 */
async function findByBrowse() {
    const contentLabel = ui.getContentLabel();
    const genres = getGenres();

    if (genres.length === 0) {
        console.log(ui.warning('No genres available for browsing.'));
        return null;
    }

    const { selectedGenre } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedGenre',
        message: 'Select a genre:',
        choices: [
            ...genres.map(g => ({ name: g.name, value: g })),
            new inquirer.Separator(),
            ui.backChoice('Cancel')
        ],
        ...ui.promptConfig({ pageSize: 15 })
    }]);

    if (!selectedGenre) return null;

    console.log(ui.loadingText(`Browsing ${selectedGenre.name}...`));

    const items = await browseByGenre(selectedGenre.url, 1);

    if (items.length === 0) {
        console.log(ui.warning(`No ${ui.getContentLabelPlural()} found in this genre.`));
        return null;
    }

    const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Found ${ui.theme.highlight(items.length)} ${ui.getContentLabelPlural()}:`,
        choices: [
            ...items.map(item => ({
                name: `${item.title} ${ui.theme.muted(`by ${item.author || 'Unknown'}`)}`,
                value: item
            })),
            new inquirer.Separator(),
            ui.backChoice('Cancel')
        ],
        ...ui.promptConfig({ pageSize: 15 })
    }]);

    return selected;
}

/**
 * Find content by direct URL
 */
async function findByUrl() {
    const activeSource = getActiveSource();
    const contentLabel = ui.getContentLabel();

    const { url } = await inquirer.prompt([{
        type: 'input',
        name: 'url',
        message: `Enter ${contentLabel} URL:`,
        validate: input => {
            if (!input.trim()) return 'Please enter a URL';
            if (!input.includes(activeSource.baseUrl) && !input.startsWith('/') && !input.startsWith('http')) {
                return `URL should be from ${activeSource.baseUrl}`;
            }
            return true;
        }
    }]);

    let fullUrl = url.trim();
    if (fullUrl.startsWith('/')) {
        fullUrl = activeSource.baseUrl + fullUrl;
    }

    return { url: fullUrl, title: 'Loading...', author: 'Unknown' };
}

/**
 * Download new content flow
 */
async function downloadNew() {
    const contentLabel = ui.getContentLabel();
    const contentLabelCap = ui.getContentLabel(true);

    console.clear();
    console.log(ui.sectionHeader(`Download New ${contentLabelCap}`));
    console.log();

    const activeSource = getActiveSource();
    if (!activeSource) {
        console.log(ui.warning('No source selected. Please select a source first.'));
        await ui.pressEnter();
        return;
    }

    console.log(ui.keyValue('Source', activeSource.name));
    console.log(ui.keyValue('Type', activeSource.contentType || 'novel'));
    console.log();

    // Build find options based on source capabilities
    const findOptions = [];

    if (supportsSearch()) {
        findOptions.push(ui.menuChoice('Search by name', 'search', 'Text search'));
    }
    if (supportsBrowse()) {
        findOptions.push(ui.menuChoice('Browse by genre', 'browse', 'Category listing'));
    }
    findOptions.push(ui.menuChoice('Enter URL directly', 'url', 'Paste a link'));
    findOptions.push(new inquirer.Separator());
    findOptions.push(ui.backChoice('Back to menu'));

    const { method } = await inquirer.prompt([{
        type: 'list',
        name: 'method',
        message: `How would you like to find a ${contentLabel}?`,
        choices: findOptions,
        ...ui.promptConfig()
    }]);

    if (!method) return;

    let selected = null;

    try {
        if (method === 'search') {
            selected = await findBySearch();
        } else if (method === 'browse') {
            selected = await findByBrowse();
        } else if (method === 'url') {
            selected = await findByUrl();
        }

        if (!selected) return;

        console.log();
        console.log(ui.loadingText(`Fetching ${contentLabel} details...`));

        const details = await getNovelDetails(selected.url);

        // Display details
        console.clear();
        console.log(ui.sectionHeader(`${contentLabelCap} Details`));
        console.log();
        console.log(ui.keyValue('Title', details.title));
        console.log(ui.keyValue('Author', details.author));
        console.log(ui.keyValue('Status', details.status));
        console.log(ui.keyValue('Chapters', details.totalChapters));

        if (details.genres && details.genres.length > 0) {
            console.log(ui.keyValue('Genres', details.genres.slice(0, 5).join(', ')));
        }
        if (details.rating) {
            console.log(ui.keyValue('Rating', details.rating));
        }
        if (details.description) {
            console.log();
            console.log(ui.theme.muted(ui.truncate(details.description, 200)));
        }
        console.log();

        const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Download ${details.totalChapters} chapters?`,
            default: true
        }]);

        if (!confirm) return;

        console.log();
        const result = await downloadNovel(details);

        // Show results
        console.log();
        console.log(ui.sectionHeader('Download Complete'));
        console.log();
        console.log(ui.success(`Downloaded: ${result.downloaded} chapters`));

        if (result.skipped > 0) {
            console.log(ui.info(`Skipped: ${result.skipped} (already downloaded)`));
        }
        if (result.failed > 0) {
            console.log(ui.error(`Failed: ${result.failed} chapters`));

            const { retry } = await inquirer.prompt([{
                type: 'confirm',
                name: 'retry',
                message: 'Retry failed chapters?',
                default: true
            }]);

            if (retry) {
                await retryFailedChapters(details.title);
            }
        }

    } catch (err) {
        console.log(ui.error(err.message));
        log.error('Download failed', { error: err.message });
    }

    await ui.pressEnter();
}

/**
 * View downloads
 */
async function viewDownloads() {
    console.clear();
    console.log(ui.sectionHeader('Your Downloads'));
    console.log();

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(ui.theme.muted('No content downloaded yet.'));
        await ui.pressEnter();
        return;
    }

    // Get progress for each item
    const items = [];
    for (const item of downloads) {
        const progress = await getDownloadProgress(item.title);
        items.push({ ...item, progress });
    }

    // Display items
    for (const item of items) {
        const prog = item.progress;
        const percentage = prog?.percentage || 0;
        const bar = ui.progressBar(prog?.downloadedCount || 0, prog?.totalChapters || 1, 20);

        const status = prog?.isComplete
            ? ui.theme.success('Complete')
            : ui.theme.warning(`${prog?.downloadedCount || 0}/${prog?.totalChapters || '?'}`);

        const typeIcon = item.contentType === 'manga' ? '📚' : '📖';

        console.log(`${typeIcon} ${ui.theme.highlight(item.title)}`);
        console.log(`   ${ui.theme.muted('Author:')} ${item.author || 'Unknown'}`);
        console.log(`   ${bar} ${status}`);

        if (prog?.failedChapters?.length > 0) {
            console.log(`   ${ui.error(`${prog.failedChapters.length} failed chapters`)}`);
        }
        console.log();
    }

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Actions:',
        choices: [
            ui.menuChoice('Resume download', 'resume', 'Continue incomplete'),
            ui.menuChoice('Retry failed', 'retry', 'Re-download failed chapters'),
            ui.menuChoice('Delete', 'delete', 'Remove from disk'),
            new inquirer.Separator(),
            ui.backChoice('Back to menu')
        ],
        ...ui.promptConfig()
    }]);

    if (!action) return;

    // Select item
    const { selectedItem } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedItem',
        message: 'Select:',
        choices: [
            ...items.map(i => ({ name: i.title, value: i })),
            new inquirer.Separator(),
            ui.backChoice('Cancel')
        ],
        ...ui.promptConfig()
    }]);

    if (!selectedItem) return;

    if (action === 'resume') {
        console.log(ui.loadingText('Resuming download...'));
        try {
            const details = await getNovelDetails(selectedItem.url);
            await downloadNovel(details, { skipExisting: true });
        } catch (err) {
            console.log(ui.error(err.message));
        }
    } else if (action === 'retry') {
        await retryFailedChapters(selectedItem.title);
    } else if (action === 'delete') {
        const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Delete "${selectedItem.title}" and all data?`,
            default: false
        }]);

        if (confirm) {
            await storage.deleteNovel(selectedItem.title);
            console.log(ui.success('Deleted successfully.'));
        }
    }

    await ui.pressEnter();
}

/**
 * Export content
 */
async function exportContent() {
    console.clear();
    console.log(ui.sectionHeader('Export'));
    console.log();

    const downloads = await storage.getAllDownloads();

    if (downloads.length === 0) {
        console.log(ui.theme.muted('No content to export. Download something first.'));
        await ui.pressEnter();
        return;
    }

    // Show existing exports
    const existing = await listExports();
    if (existing.length > 0) {
        console.log(ui.theme.muted('Existing exports:'));
        for (const exp of existing.slice(0, 5)) {
            console.log(ui.listItem(`${exp.filename} ${ui.theme.muted(`(${exp.format}, ${exp.size})`)}`));
        }
        console.log();
    }

    const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select content to export:',
        choices: [
            ...downloads.map(d => {
                const chapters = d.totalChapters || d.chapters?.length || '?';
                return {
                    name: `${d.title} ${ui.theme.muted(`(${chapters} chapters)`)}`,
                    value: d
                };
            }),
            new inquirer.Separator(),
            ui.backChoice('Cancel')
        ],
        ...ui.promptConfig()
    }]);

    if (!selected) return;

    const downloadedChapters = await storage.getDownloadedChapters(selected.title);
    if (downloadedChapters.length === 0) {
        console.log(ui.warning('No chapters downloaded yet.'));
        await ui.pressEnter();
        return;
    }

    const { format } = await inquirer.prompt([{
        type: 'list',
        name: 'format',
        message: 'Select format:',
        choices: [
            new inquirer.Separator(ui.theme.muted('── E-Book ──')),
            ui.menuChoice('EPUB', 'epub', 'Universal e-reader format'),
            ui.menuChoice('AZW3', 'azw3', 'Kindle modern'),
            ui.menuChoice('MOBI', 'mobi', 'Kindle legacy'),
            new inquirer.Separator(ui.theme.muted('── Documents ──')),
            ui.menuChoice('PDF', 'pdf', 'Print-ready'),
            ui.menuChoice('DOCX', 'docx', 'Microsoft Word'),
            ui.menuChoice('ODT', 'odt', 'LibreOffice'),
            ui.menuChoice('RTF', 'rtf', 'Rich Text'),
            new inquirer.Separator(ui.theme.muted('── Other ──')),
            ui.menuChoice('HTML', 'html', 'Web page'),
            ui.menuChoice('TXT', 'txt', 'Plain text'),
            new inquirer.Separator(),
            ui.backChoice('Cancel')
        ],
        ...ui.promptConfig({ pageSize: 15 })
    }]);

    if (!format) return;

    console.log(ui.loadingText(`Exporting ${downloadedChapters.length} chapters...`));

    try {
        const exportFn = {
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

        await exportFn[format](selected.title);
        console.log(ui.success('Export complete!'));
    } catch (err) {
        console.log(ui.error(`Export failed: ${err.message}`));
        log.error('Export failed', { error: err.message, format });
    }

    await ui.pressEnter();
}

/**
 * Get source capabilities summary
 */
function getSourceCapabilities(source) {
    const caps = [];
    const limitations = [];

    // Check search capability
    if (source.search) {
        if (source.search.type === 'browse') {
            limitations.push('No text search (JS-based)');
        } else {
            caps.push('Text search');
        }
    }

    // Check browse capability
    if (source.browse?.enabled) {
        caps.push('Genre browse');
    }

    // Check chapter list pagination
    if (source.chapterList?.pagination?.type === 'none') {
        if (source.notes?.chapterListLimitation) {
            limitations.push('Limited chapter detection');
        }
    } else {
        caps.push('Full chapter list');
    }

    // Check for other notes/limitations
    if (source.notes) {
        if (source.notes.chapterRedirect) {
            limitations.push('Chapter redirects');
        }
        if (source.notes.browseLimitation) {
            limitations.push('Browse may be limited');
        }
    }

    // Content type specific
    if (source.contentType === 'manga') {
        caps.push('Image chapters');
        if (source.chapterContent?.scriptArrayPattern) {
            caps.push('JS image extraction');
        }
    } else {
        caps.push('Text chapters');
    }

    return { capabilities: caps, limitations };
}

/**
 * Sources management
 */
async function manageSources() {
    console.clear();
    console.log(ui.sectionHeader('Sources'));
    console.log();

    const sources = await loadSources();

    if (sources.length === 0) {
        console.log(ui.warning('No sources found.'));
        console.log(ui.theme.muted('Add source configurations to the sources/ directory.'));
        await ui.pressEnter();
        return;
    }

    const activeSource = getActiveSource();

    // Group sources by type
    const novelSources = sources.filter(s => s.contentType !== 'manga');
    const mangaSources = sources.filter(s => s.contentType === 'manga');

    // Display novel sources
    if (novelSources.length > 0) {
        console.log(ui.theme.highlight('📖 Novel Sources'));
        console.log();
        for (const source of novelSources) {
            displaySourceInfo(source, activeSource);
        }
    }

    // Display manga sources
    if (mangaSources.length > 0) {
        console.log(ui.theme.highlight('📚 Manga Sources'));
        console.log();
        for (const source of mangaSources) {
            displaySourceInfo(source, activeSource);
        }
    }

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Actions:',
        choices: [
            ui.menuChoice('Select active source', 'select'),
            ui.menuChoice('Enable/Disable source', 'toggle'),
            ui.menuChoice('View source details', 'details'),
            new inquirer.Separator(),
            ui.backChoice('Back to menu')
        ],
        ...ui.promptConfig()
    }]);

    if (!action) return;

    if (action === 'select') {
        const enabled = await getEnabledSources();

        if (enabled.length === 0) {
            console.log(ui.warning('No enabled sources. Enable a source first.'));
            await ui.pressEnter();
            return;
        }

        const { selectedId } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedId',
            message: 'Select source:',
            choices: [
                ...enabled.map(s => {
                    const icon = s.contentType === 'manga' ? '📚' : '📖';
                    const current = activeSource?.id === s.id ? ui.theme.success(' (active)') : '';
                    return {
                        name: `${icon} ${s.name}${current}`,
                        value: s.id
                    };
                }),
                new inquirer.Separator(),
                ui.backChoice('Cancel')
            ],
            ...ui.promptConfig()
        }]);

        if (selectedId) {
            await setActiveSource(selectedId);
            console.log(ui.success(`Active source: ${selectedId}`));
        }

    } else if (action === 'toggle') {
        const { selected } = await inquirer.prompt([{
            type: 'list',
            name: 'selected',
            message: 'Select source:',
            choices: [
                ...sources.map(s => {
                    const status = s.enabled ? ui.theme.success('[ON]') : ui.theme.error('[OFF]');
                    return { name: `${status} ${s.name}`, value: s };
                }),
                new inquirer.Separator(),
                ui.backChoice('Cancel')
            ],
            ...ui.promptConfig()
        }]);

        if (selected) {
            const newState = !selected.enabled;
            await setSourceEnabled(selected.id, newState);
            console.log(ui.success(`${selected.name} ${newState ? 'enabled' : 'disabled'}`));
        }

    } else if (action === 'details') {
        const { selected } = await inquirer.prompt([{
            type: 'list',
            name: 'selected',
            message: 'Select source:',
            choices: [
                ...sources.map(s => ({ name: s.name, value: s })),
                new inquirer.Separator(),
                ui.backChoice('Cancel')
            ],
            ...ui.promptConfig()
        }]);

        if (selected) {
            await showSourceDetails(selected);
        }
    }

    await ui.pressEnter();
}

/**
 * Display source info in list
 */
function displaySourceInfo(source, activeSource) {
    const isActive = activeSource?.id === source.id;
    const statusIcon = source.enabled
        ? (isActive ? ui.theme.success('●') : ui.theme.primary('○'))
        : ui.theme.muted('○');

    const { capabilities, limitations } = getSourceCapabilities(source);

    console.log(`  ${statusIcon} ${ui.theme.highlight(source.name)} ${isActive ? ui.theme.success('(active)') : ''}`);
    console.log(`     ${ui.theme.muted(source.baseUrl)}`);

    if (capabilities.length > 0) {
        console.log(`     ${ui.theme.success('✓')} ${ui.theme.muted(capabilities.join(' • '))}`);
    }
    if (limitations.length > 0) {
        console.log(`     ${ui.theme.warning('!')} ${ui.theme.muted(limitations.join(' • '))}`);
    }
    console.log();
}

/**
 * Show detailed source information
 */
async function showSourceDetails(source) {
    console.clear();
    console.log(ui.sectionHeader(`Source: ${source.name}`));
    console.log();

    const { capabilities, limitations } = getSourceCapabilities(source);

    console.log(ui.keyValue('Name', source.name));
    console.log(ui.keyValue('ID', source.id));
    console.log(ui.keyValue('URL', source.baseUrl));
    console.log(ui.keyValue('Type', source.contentType || 'novel'));
    console.log(ui.keyValue('Version', source.version || '1.0.0'));
    console.log(ui.keyValue('Status', source.enabled ? ui.theme.success('Enabled') : ui.theme.error('Disabled')));
    console.log();

    console.log(ui.theme.highlight('Capabilities:'));
    if (capabilities.length > 0) {
        for (const cap of capabilities) {
            console.log(`  ${ui.theme.success('✓')} ${cap}`);
        }
    } else {
        console.log(ui.theme.muted('  None detected'));
    }
    console.log();

    if (limitations.length > 0) {
        console.log(ui.theme.highlight('Limitations:'));
        for (const lim of limitations) {
            console.log(`  ${ui.theme.warning('!')} ${lim}`);
        }
        console.log();
    }

    // Show notes if available
    if (source.notes) {
        console.log(ui.theme.highlight('Notes:'));
        for (const [key, value] of Object.entries(source.notes)) {
            console.log(`  ${ui.theme.muted(key)}: ${ui.truncate(value, 60)}`);
        }
    }
}

/**
 * Settings menu
 */
async function showSettings() {
    console.clear();
    console.log(ui.sectionHeader('Settings'));
    console.log();

    const settings = getSettings();

    const { setting } = await inquirer.prompt([{
        type: 'list',
        name: 'setting',
        message: 'Configure:',
        choices: [
            {
                name: `Detailed Logs: ${settings.detailedLogs ? ui.theme.success('ON') : ui.theme.muted('OFF')}`,
                value: 'detailedLogs'
            },
            new inquirer.Separator(),
            ui.backChoice('Back')
        ],
        ...ui.promptConfig()
    }]);

    if (setting === 'detailedLogs') {
        const newValue = !settings.detailedLogs;
        await setSetting('detailedLogs', newValue);
        setDetailedLogs(newValue);
        console.log(ui.success(`Detailed logs ${newValue ? 'enabled' : 'disabled'}`));
        await ui.pressEnter();
    }
}

/**
 * Main application loop
 */
async function main() {
    log.info('Application started');

    // Load settings
    const settings = await loadSettings();
    setDetailedLogs(settings.detailedLogs);

    // Load sources
    const sources = await loadSources();
    if (sources.length === 0) {
        console.log(ui.warning('No sources found in sources/ directory'));
    } else {
        const activeSource = getActiveSource();
        if (activeSource) {
            log.info(`Active source: ${activeSource.name}`);
        }
    }

    // Ensure data directory
    await storage.ensureDataDir();

    let running = true;

    while (running) {
        try {
            const action = await mainMenu();

            switch (action) {
                case 'download':
                    await downloadNew();
                    break;
                case 'downloads':
                    await viewDownloads();
                    break;
                case 'export':
                    await exportContent();
                    break;
                case 'sources':
                    await manageSources();
                    break;
                case 'dependencies':
                    await manageDependencies();
                    await ui.pressEnter();
                    break;
                case 'settings':
                    await showSettings();
                    break;
                case 'exit':
                    running = false;
                    break;
            }
        } catch (err) {
            if (err.name === 'ExitPromptError') {
                running = false;
            } else {
                console.log(ui.error(`Unexpected error: ${err.message}`));
                log.error('Unexpected error', { error: err.message, stack: err.stack });
                await ui.pressEnter();
            }
        }
    }

    console.log(ui.theme.primary('\nGoodbye! Happy reading!\n'));
    log.info('Application exited');
    process.exit(0);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log(ui.theme.primary('\n\nGoodbye!\n'));
    process.exit(0);
});

// Run
main().catch(err => {
    console.error(ui.error('Fatal error:'), err);
    process.exit(1);
});
