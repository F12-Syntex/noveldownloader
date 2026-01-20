/**
 * Source Loader
 * Loads sources from filesystem with capability validation and inference
 */

import { promises as fs } from 'fs';
import path from 'path';
import { log } from '../../logger.js';
import {
  ContentType,
  Capabilities,
  getCapabilitiesForType
} from '../content/types.js';

// Use cwd for sources directory (works in both ESM and bundled contexts)
const SOURCES_DIR = path.join(process.cwd(), 'sources');

/**
 * Infer capabilities from source configuration
 * @param {Object} source - Source configuration
 * @returns {string[]}
 */
function inferCapabilities(source) {
  const caps = new Set();
  const contentType = source.contentType || ContentType.NOVEL;

  // Infer search capabilities
  if (source.search && source.search.url) {
    caps.add(Capabilities.SEARCH_TEXT);
  }
  if (source.browse && source.browse.enabled) {
    caps.add(Capabilities.SEARCH_BROWSE);
  }
  // URL support is always available for HTTP-based sources
  if (contentType !== ContentType.ANIME) {
    caps.add(Capabilities.SEARCH_URL);
  }

  // Infer content type capabilities
  switch (contentType) {
    case ContentType.NOVEL:
      caps.add(Capabilities.CONTENT_TEXT);
      caps.add(Capabilities.DOWNLOAD_SEQUENTIAL);
      caps.add(Capabilities.EXPORT_EPUB);
      caps.add(Capabilities.EXPORT_PDF);
      caps.add(Capabilities.EXPORT_DOCX);
      caps.add(Capabilities.EXPORT_TXT);
      caps.add(Capabilities.EXPORT_HTML);
      break;

    case ContentType.MANGA:
      caps.add(Capabilities.CONTENT_IMAGES);
      caps.add(Capabilities.DOWNLOAD_SEQUENTIAL);
      caps.add(Capabilities.EXPORT_CBZ);
      caps.add(Capabilities.EXPORT_PDF);
      break;

    case ContentType.ANIME:
      caps.add(Capabilities.CONTENT_TORRENT);
      caps.add(Capabilities.DOWNLOAD_TORRENT);
      // Check for search capabilities in torrent config
      if (source.search && source.search.url) {
        caps.add(Capabilities.SEARCH_TEXT);
      }
      if (source.browse && source.browse.categories) {
        caps.add(Capabilities.SEARCH_BROWSE);
      }
      break;
  }

  return Array.from(caps);
}

/**
 * Validate source configuration
 * @param {Object} source - Source configuration
 * @returns {Object} - Validation result with isValid and errors
 */
function validateSource(source) {
  const errors = [];

  // Required fields
  if (!source.name) errors.push('Missing required field: name');
  if (!source.id) errors.push('Missing required field: id');
  if (!source.baseUrl) errors.push('Missing required field: baseUrl');

  // Content type validation
  const validTypes = Object.values(ContentType);
  if (source.contentType && !validTypes.includes(source.contentType)) {
    errors.push(`Invalid contentType: ${source.contentType}. Must be one of: ${validTypes.join(', ')}`);
  }

  // URL validation
  if (source.baseUrl) {
    try {
      new URL(source.baseUrl);
    } catch {
      errors.push(`Invalid baseUrl: ${source.baseUrl}`);
    }
  }

  // Search configuration validation
  if (source.search) {
    if (!source.search.url) {
      errors.push('Search configuration missing url');
    }
    if (!source.search.resultSelector && source.contentType !== ContentType.ANIME) {
      errors.push('Search configuration missing resultSelector');
    }
  }

  // Capability validation
  if (source.capabilities) {
    const validCaps = Object.values(Capabilities);
    for (const cap of source.capabilities) {
      if (!validCaps.includes(cap)) {
        errors.push(`Invalid capability: ${cap}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Normalize source configuration
 * - Ensures contentType is set
 * - Infers capabilities if not provided
 * - Adds default values
 * @param {Object} source - Source configuration
 * @returns {Object}
 */
function normalizeSource(source) {
  const normalized = { ...source };

  // Set default content type
  if (!normalized.contentType) {
    // Infer from configuration
    if (normalized.mangaDetails || normalized.chapterContent?.type === 'images') {
      normalized.contentType = ContentType.MANGA;
    } else if (normalized.torrentConfig) {
      normalized.contentType = ContentType.ANIME;
    } else {
      normalized.contentType = ContentType.NOVEL;
    }
  }

  // Infer capabilities if not provided
  if (!normalized.capabilities || normalized.capabilities.length === 0) {
    normalized.capabilities = inferCapabilities(normalized);
  }

  // Ensure enabled flag exists
  if (normalized.enabled === undefined) {
    normalized.enabled = true;
  }

  // Default HTTP config
  if (!normalized.http) {
    normalized.http = {};
  }
  normalized.http = {
    timeout: normalized.http.timeout || 15000,
    retryAttempts: normalized.http.retryAttempts || 3,
    retryDelay: normalized.http.retryDelay || 1000,
    rateLimit: normalized.http.rateLimit || 300,
    userAgent: normalized.http.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  return normalized;
}

/**
 * Load a single source from a directory
 * @param {string} directory - Source directory name
 * @returns {Object|null}
 */
async function loadSourceFromDirectory(directory) {
  const sourceConfigPath = path.join(SOURCES_DIR, directory, 'source.json');

  try {
    const configData = await fs.readFile(sourceConfigPath, 'utf-8');
    const config = JSON.parse(configData);

    // Add directory metadata
    config._directory = directory;
    config._configPath = sourceConfigPath;

    // Normalize the source
    const normalized = normalizeSource(config);

    // Validate
    const validation = validateSource(normalized);
    if (!validation.isValid) {
      log.warn(`Source ${directory} has validation errors:`, validation.errors);
    }

    return normalized;
  } catch (err) {
    log.warn(`Failed to load source from ${directory}: ${err.message}`);
    return null;
  }
}

/**
 * Load all available sources from the sources directory
 * @returns {Promise<Object[]>}
 */
export async function loadSources() {
  const sources = [];

  try {
    // Ensure sources directory exists
    await fs.mkdir(SOURCES_DIR, { recursive: true });

    // Read all directories in sources folder
    const entries = await fs.readdir(SOURCES_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const source = await loadSourceFromDirectory(entry.name);
        if (source) {
          sources.push(source);
          log.debug(`Loaded source: ${source.name} (${source.id}) [${source.contentType}]`);
        }
      }
    }

    log.info(`Loaded ${sources.length} source(s)`);
    return sources;
  } catch (err) {
    log.error('Failed to load sources', { error: err.message });
    return [];
  }
}

/**
 * Load a single source by ID
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object|null>}
 */
export async function loadSourceById(sourceId) {
  try {
    const entries = await fs.readdir(SOURCES_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const source = await loadSourceFromDirectory(entry.name);
        if (source && source.id === sourceId) {
          return source;
        }
      }
    }

    return null;
  } catch (err) {
    log.error(`Failed to load source ${sourceId}`, { error: err.message });
    return null;
  }
}

/**
 * Get sources grouped by content type
 * @param {Object[]} sources - Array of sources
 * @returns {Object}
 */
export function groupSourcesByType(sources) {
  const grouped = {
    [ContentType.NOVEL]: [],
    [ContentType.MANGA]: [],
    [ContentType.ANIME]: []
  };

  for (const source of sources) {
    const type = source.contentType || ContentType.NOVEL;
    if (grouped[type]) {
      grouped[type].push(source);
    }
  }

  return grouped;
}

/**
 * Get enabled sources of a specific content type
 * @param {Object[]} sources - Array of sources
 * @param {string} contentType - Content type to filter
 * @returns {Object[]}
 */
export function getSourcesByType(sources, contentType) {
  return sources.filter(s => s.enabled && s.contentType === contentType);
}

/**
 * Save source configuration back to disk
 * @param {Object} source - Source configuration
 */
export async function saveSource(source) {
  if (!source._configPath) {
    throw new Error('Source does not have a config path');
  }

  const configToSave = { ...source };
  delete configToSave._directory;
  delete configToSave._configPath;

  await fs.writeFile(
    source._configPath,
    JSON.stringify(configToSave, null, 4),
    'utf-8'
  );

  log.info(`Saved source configuration: ${source.name}`);
}

/**
 * Get sources directory path
 * @returns {string}
 */
export function getSourcesDirectory() {
  return SOURCES_DIR;
}

export default {
  loadSources,
  loadSourceById,
  groupSourcesByType,
  getSourcesByType,
  saveSource,
  getSourcesDirectory,
  validateSource,
  normalizeSource,
  inferCapabilities
};
