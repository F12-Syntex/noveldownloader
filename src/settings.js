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
    activeSourceId: null,
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
