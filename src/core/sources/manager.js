/**
 * Source Manager
 * Manages active source, switching, and provides content-type-aware operations
 */

import { log } from '../../logger.js';
import {
  loadSources,
  loadSourceById,
  groupSourcesByType,
  getSourcesByType,
  saveSource
} from './loader.js';
import {
  ContentType,
  hasCapability,
  hasAnyCapability,
  getContentTypeDisplay
} from '../content/types.js';

// State
let sourcesCache = null;
let activeSource = null;

/**
 * Initialize the source manager
 * Loads all sources and sets a default active source
 * @returns {Promise<Object[]>}
 */
export async function initialize() {
  sourcesCache = await loadSources();

  // Set default active source if none set
  if (!activeSource && sourcesCache.length > 0) {
    const enabledSources = sourcesCache.filter(s => s.enabled);
    if (enabledSources.length > 0) {
      activeSource = enabledSources[0];
      log.info(`Default source set to: ${activeSource.name}`);
    }
  }

  return sourcesCache;
}

/**
 * Get all sources (loads if not cached)
 * @returns {Promise<Object[]>}
 */
export async function getSources() {
  if (!sourcesCache) {
    await initialize();
  }
  return sourcesCache;
}

/**
 * Get enabled sources
 * @returns {Promise<Object[]>}
 */
export async function getEnabledSources() {
  const sources = await getSources();
  return sources.filter(s => s.enabled);
}

/**
 * Get sources by content type
 * @param {string} contentType - Content type to filter
 * @returns {Promise<Object[]>}
 */
export async function getSourcesByContentType(contentType) {
  const sources = await getSources();
  return getSourcesByType(sources, contentType);
}

/**
 * Get sources grouped by content type
 * @returns {Promise<Object>}
 */
export async function getSourcesGrouped() {
  const sources = await getSources();
  return groupSourcesByType(sources);
}

/**
 * Get a source by ID
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object|null>}
 */
export async function getSourceById(sourceId) {
  const sources = await getSources();
  return sources.find(s => s.id === sourceId) || null;
}

/**
 * Get the currently active source
 * @returns {Object|null}
 */
export function getActiveSource() {
  return activeSource;
}

/**
 * Get the content type of the active source
 * @returns {string|null}
 */
export function getActiveContentType() {
  return activeSource?.contentType || null;
}

/**
 * Check if active source is of a specific content type
 * @param {string} contentType - Content type to check
 * @returns {boolean}
 */
export function isActiveType(contentType) {
  return activeSource?.contentType === contentType;
}

/**
 * Check if active source has a specific capability
 * @param {string} capability - Capability to check
 * @returns {boolean}
 */
export function activeHasCapability(capability) {
  return activeSource ? hasCapability(activeSource, capability) : false;
}

/**
 * Check if active source has any of the given capabilities
 * @param {string[]} capabilities - Capabilities to check
 * @returns {boolean}
 */
export function activeHasAnyCapability(capabilities) {
  return activeSource ? hasAnyCapability(activeSource, capabilities) : false;
}

/**
 * Set the active source by ID
 * @param {string} sourceId - Source ID to activate
 * @returns {Promise<Object>}
 */
export async function setActiveSource(sourceId) {
  const source = await getSourceById(sourceId);

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  if (!source.enabled) {
    throw new Error(`Source "${source.name}" is disabled`);
  }

  activeSource = source;
  log.info(`Active source set to: ${source.name} [${source.contentType}]`);

  return source;
}

/**
 * Clear the active source
 */
export function clearActiveSource() {
  activeSource = null;
}

/**
 * Reload all sources from disk
 * @returns {Promise<Object[]>}
 */
export async function reloadSources() {
  sourcesCache = null;
  const currentActiveId = activeSource?.id;
  activeSource = null;

  const sources = await initialize();

  // Try to restore the previously active source
  if (currentActiveId) {
    const previousSource = sources.find(s => s.id === currentActiveId && s.enabled);
    if (previousSource) {
      activeSource = previousSource;
    }
  }

  return sources;
}

/**
 * Enable or disable a source
 * @param {string} sourceId - Source ID
 * @param {boolean} enabled - Whether to enable
 * @returns {Promise<Object>}
 */
export async function setSourceEnabled(sourceId, enabled) {
  const source = await getSourceById(sourceId);

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  source.enabled = enabled;
  await saveSource(source);

  log.info(`Source ${source.name} ${enabled ? 'enabled' : 'disabled'}`);

  // If we disabled the active source, clear it and pick a new one
  if (!enabled && activeSource?.id === sourceId) {
    activeSource = null;
    const enabledSources = await getEnabledSources();
    if (enabledSources.length > 0) {
      activeSource = enabledSources[0];
      log.info(`Active source changed to: ${activeSource.name}`);
    }
  }

  return source;
}

/**
 * Get display info for the active source
 * @returns {Object}
 */
export function getActiveSourceDisplay() {
  if (!activeSource) {
    return {
      name: 'No source selected',
      icon: '',
      contentType: null,
      capabilities: []
    };
  }

  const display = getContentTypeDisplay(activeSource.contentType);

  return {
    name: activeSource.name,
    icon: display.icon,
    contentType: activeSource.contentType,
    capabilities: activeSource.capabilities || [],
    baseUrl: activeSource.baseUrl
  };
}

/**
 * Build URL from template with variable substitution
 * @param {string} template - URL template
 * @param {Object} variables - Variables to substitute
 * @returns {string}
 */
export function buildUrl(template, variables = {}) {
  let url = template;

  // First handle baseUrl without encoding
  const baseUrl = variables.baseUrl || activeSource?.baseUrl || '';
  url = url.replace(/{baseUrl}/g, baseUrl);

  // Then handle other variables with encoding
  for (const [key, value] of Object.entries(variables)) {
    if (key === 'baseUrl') continue;
    url = url.replace(new RegExp(`\\{${key}\\}`, 'g'), encodeURIComponent(value || ''));
  }

  return url;
}

/**
 * Ensure a URL is absolute using the active source's base URL
 * @param {string} url - URL to make absolute
 * @param {string} [baseUrl] - Optional base URL override
 * @returns {string}
 */
export function ensureAbsoluteUrl(url, baseUrl = null) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const base = baseUrl || activeSource?.baseUrl || '';
  return base + (url.startsWith('/') ? '' : '/') + url;
}

/**
 * Get HTTP configuration for the active source
 * @returns {Object}
 */
export function getHttpConfig() {
  const source = activeSource || {};
  return {
    timeout: source.http?.timeout || 15000,
    retryAttempts: source.http?.retryAttempts || 3,
    retryDelay: source.http?.retryDelay || 1000,
    rateLimit: source.http?.rateLimit || 300,
    userAgent: source.http?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
}

/**
 * Get search configuration from active source
 * @returns {Object|null}
 */
export function getSearchConfig() {
  return activeSource?.search || null;
}

/**
 * Get browse configuration from active source
 * @returns {Object|null}
 */
export function getBrowseConfig() {
  return activeSource?.browse || null;
}

/**
 * Get details configuration based on content type
 * @returns {Object|null}
 */
export function getDetailsConfig() {
  if (!activeSource) return null;

  switch (activeSource.contentType) {
    case ContentType.NOVEL:
      return activeSource.novelDetails || null;
    case ContentType.MANGA:
      return activeSource.mangaDetails || null;
    case ContentType.ANIME:
      return activeSource.torrentDetails || null;
    default:
      return activeSource.novelDetails || activeSource.mangaDetails || null;
  }
}

/**
 * Get chapter/content configuration
 * @returns {Object|null}
 */
export function getChapterConfig() {
  return activeSource?.chapterList || null;
}

/**
 * Get content extraction configuration
 * @returns {Object|null}
 */
export function getContentConfig() {
  return activeSource?.chapterContent || null;
}

/**
 * Get torrent-specific configuration
 * @returns {Object|null}
 */
export function getTorrentConfig() {
  return activeSource?.torrentConfig || null;
}

export default {
  initialize,
  getSources,
  getEnabledSources,
  getSourcesByContentType,
  getSourcesGrouped,
  getSourceById,
  getActiveSource,
  getActiveContentType,
  isActiveType,
  activeHasCapability,
  activeHasAnyCapability,
  setActiveSource,
  clearActiveSource,
  reloadSources,
  setSourceEnabled,
  getActiveSourceDisplay,
  buildUrl,
  ensureAbsoluteUrl,
  getHttpConfig,
  getSearchConfig,
  getBrowseConfig,
  getDetailsConfig,
  getChapterConfig,
  getContentConfig,
  getTorrentConfig
};
