/**
 * Settings Module
 * Manages user preferences
 */

import fs from 'fs/promises';
import path from 'path';

const SETTINGS_FILE = 'settings.json';

const DEFAULT_SETTINGS = {
    detailedLogs: false,
    delayBetweenChapters: 400,
    // Path settings
    basePath: '', // Empty means current directory, can be absolute path like 'D:\\Media'
    downloadPath: 'downloads',
    dataPath: 'data',
    exportPath: 'exports',
    tempPath: 'temp',
    // Anime/Torrent settings
    animeDownloadPath: 'downloads/anime',
    minSeeders: 1,
    preferredQuality: '1080p', // 480p, 720p, 1080p, 4K
    trustedOnly: false,
};

let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Load settings from file
 */
export async function loadSettings() {
    try {
        const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
        currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
    } catch {
        currentSettings = { ...DEFAULT_SETTINGS };
    }
    return currentSettings;
}

/**
 * Save settings to file
 */
export async function saveSettings(settings) {
    currentSettings = { ...currentSettings, ...settings };
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2), 'utf-8');
    return currentSettings;
}

/**
 * Get current settings
 */
export function getSettings() {
    return currentSettings;
}

/**
 * Get a specific setting
 */
export function getSetting(key) {
    return currentSettings[key];
}

/**
 * Update a specific setting
 */
export async function setSetting(key, value) {
    currentSettings[key] = value;
    await saveSettings(currentSettings);
    return currentSettings;
}

/**
 * Resolve a path relative to the base path
 * If the path is absolute, returns it as-is
 * If basePath is set, joins basePath with the relative path
 */
export function resolvePath(relativePath) {
    // If the path is already absolute, return it
    if (path.isAbsolute(relativePath)) {
        return relativePath;
    }

    const basePath = currentSettings.basePath;
    if (basePath) {
        return path.join(basePath, relativePath);
    }

    return relativePath;
}
