/**
 * Source Manager Module
 * Handles loading, managing, and selecting novel sources
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';
import { getSetting, setSetting } from './settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCES_DIR = path.join(__dirname, '..', 'sources');

// Cache of loaded sources
let sourcesCache = null;
let activeSource = null;

/**
 * Load all available sources from the sources directory
 */
export async function loadSources() {
    if (sourcesCache) {
        return sourcesCache;
    }

    const sources = [];

    try {
        // Ensure sources directory exists
        await fs.mkdir(SOURCES_DIR, { recursive: true });

        // Read all directories in sources folder
        const entries = await fs.readdir(SOURCES_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const sourceConfigPath = path.join(SOURCES_DIR, entry.name, 'source.json');

                try {
                    const configData = await fs.readFile(sourceConfigPath, 'utf-8');
                    const config = JSON.parse(configData);

                    // Add directory info to source
                    config._directory = entry.name;
                    config._configPath = sourceConfigPath;

                    sources.push(config);
                    log.debug(`Loaded source: ${config.name} (${config.id})`);
                } catch (err) {
                    log.warn(`Failed to load source from ${entry.name}: ${err.message}`);
                }
            }
        }

        sourcesCache = sources;
        log.info(`Loaded ${sources.length} source(s)`);

        // Load active source from settings
        const savedSourceId = getSetting('activeSourceId');
        if (savedSourceId && !activeSource) {
            const savedSource = sources.find(s => s.id === savedSourceId && s.enabled);
            if (savedSource) {
                activeSource = savedSource;
            }
        }

        // Set default active source if none set
        if (!activeSource && sources.length > 0) {
            const enabledSources = sources.filter(s => s.enabled);
            if (enabledSources.length > 0) {
                activeSource = enabledSources[0];
                // Save to settings
                await setSetting('activeSourceId', activeSource.id);
            }
        }

        return sources;
    } catch (err) {
        log.error('Failed to load sources', { error: err.message });
        return [];
    }
}

/**
 * Get all enabled sources
 */
export async function getEnabledSources() {
    const sources = await loadSources();
    return sources.filter(s => s.enabled);
}

/**
 * Get a source by its ID
 */
export async function getSourceById(sourceId) {
    const sources = await loadSources();
    return sources.find(s => s.id === sourceId);
}

/**
 * Get the currently active source
 */
export function getActiveSource() {
    return activeSource;
}

/**
 * Set the active source by ID
 */
export async function setActiveSource(sourceId) {
    const source = await getSourceById(sourceId);
    if (source) {
        activeSource = source;
        // Save to settings
        await setSetting('activeSourceId', sourceId);
        log.info(`Active source set to: ${source.name}`);
        return source;
    }
    throw new Error(`Source not found: ${sourceId}`);
}

/**
 * Reload sources from disk (clears cache)
 */
export async function reloadSources() {
    sourcesCache = null;
    activeSource = null;
    return await loadSources();
}

/**
 * Enable or disable a source
 */
export async function setSourceEnabled(sourceId, enabled) {
    const source = await getSourceById(sourceId);
    if (!source) {
        throw new Error(`Source not found: ${sourceId}`);
    }

    source.enabled = enabled;

    // Write updated config back to file
    const configPath = source._configPath;
    const configToSave = { ...source };
    delete configToSave._directory;
    delete configToSave._configPath;

    await fs.writeFile(configPath, JSON.stringify(configToSave, null, 4), 'utf-8');
    log.info(`Source ${source.name} ${enabled ? 'enabled' : 'disabled'}`);

    // If we disabled the active source, clear it
    if (!enabled && activeSource?.id === sourceId) {
        activeSource = null;
        const enabledSources = await getEnabledSources();
        if (enabledSources.length > 0) {
            activeSource = enabledSources[0];
        }
    }

    return source;
}

/**
 * Build a URL from a template with variable substitution
 */
export function buildUrl(template, variables) {
    let url = template;

    // First handle baseUrl without encoding
    if (variables.baseUrl) {
        url = url.replace(/{baseUrl}/g, variables.baseUrl);
    }

    // Then handle other variables with encoding
    for (const [key, value] of Object.entries(variables)) {
        if (key === 'baseUrl') continue; // Already handled
        url = url.replace(new RegExp(`\\{${key}\\}`, 'g'), encodeURIComponent(value));
    }

    return url;
}

/**
 * Get HTTP configuration for a source
 */
export function getHttpConfig(source) {
    return {
        timeout: source.http?.timeout || 15000,
        retryAttempts: source.http?.retryAttempts || 3,
        retryDelay: source.http?.retryDelay || 1000,
        rateLimit: source.http?.rateLimit || 300,
        userAgent: source.http?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
}

/**
 * Ensure a URL is absolute
 */
export function ensureAbsoluteUrl(url, baseUrl) {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    return baseUrl + (url.startsWith('/') ? '' : '/') + url;
}

/**
 * Get source directory path
 */
export function getSourcesDirectory() {
    return SOURCES_DIR;
}

/**
 * Get terminology based on content type
 * Returns appropriate terms for the active source's content type
 */
export function getTerms() {
    const contentType = activeSource?.contentType || 'novel';

    const terms = {
        novel: {
            item: 'novel',
            Item: 'Novel',
            items: 'novels',
            Items: 'Novels',
            unit: 'chapter',
            Unit: 'Chapter',
            units: 'chapters',
            Units: 'Chapters',
        },
        lightnovel: {
            item: 'light novel',
            Item: 'Light Novel',
            items: 'light novels',
            Items: 'Light Novels',
            unit: 'chapter',
            Unit: 'Chapter',
            units: 'chapters',
            Units: 'Chapters',
        },
        manga: {
            item: 'manga',
            Item: 'Manga',
            items: 'manga',
            Items: 'Manga',
            unit: 'chapter',
            Unit: 'Chapter',
            units: 'chapters',
            Units: 'Chapters',
        },
        webtoon: {
            item: 'webtoon',
            Item: 'Webtoon',
            items: 'webtoons',
            Items: 'Webtoons',
            unit: 'episode',
            Unit: 'Episode',
            units: 'episodes',
            Units: 'Episodes',
        },
        fanfiction: {
            item: 'fanfic',
            Item: 'Fanfic',
            items: 'fanfics',
            Items: 'Fanfics',
            unit: 'chapter',
            Unit: 'Chapter',
            units: 'chapters',
            Units: 'Chapters',
        },
    };

    return terms[contentType] || terms.novel;
}
