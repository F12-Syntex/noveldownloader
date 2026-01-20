/**
 * Content Types and Capabilities
 * Core type definitions for the unified content system
 */

/**
 * Content type enum - defines what kind of content a source provides
 */
export const ContentType = {
  NOVEL: 'novel',
  MANGA: 'manga',
  ANIME: 'anime'
};

/**
 * Capability enum - defines what a source or handler can do
 */
export const Capabilities = {
  // Search capabilities
  SEARCH_TEXT: 'search:text',           // Can search by text query
  SEARCH_BROWSE: 'search:browse',       // Can browse categories/genres
  SEARCH_URL: 'search:url',             // Can fetch from direct URL

  // Content format capabilities
  CONTENT_TEXT: 'content:text',         // Provides text content (novels)
  CONTENT_IMAGES: 'content:images',     // Provides image content (manga)
  CONTENT_TORRENT: 'content:torrent',   // Provides torrent files (anime)

  // Download method capabilities
  DOWNLOAD_SEQUENTIAL: 'download:sequential',   // HTTP-based sequential downloads
  DOWNLOAD_TORRENT: 'download:torrent',         // P2P torrent downloads

  // Export format capabilities
  EXPORT_EPUB: 'export:epub',
  EXPORT_PDF: 'export:pdf',
  EXPORT_DOCX: 'export:docx',
  EXPORT_TXT: 'export:txt',
  EXPORT_CBZ: 'export:cbz',
  EXPORT_HTML: 'export:html'
};

/**
 * Maps content types to their typical capabilities
 */
export const ContentTypeDefaults = {
  [ContentType.NOVEL]: [
    Capabilities.CONTENT_TEXT,
    Capabilities.DOWNLOAD_SEQUENTIAL,
    Capabilities.EXPORT_EPUB,
    Capabilities.EXPORT_PDF,
    Capabilities.EXPORT_DOCX,
    Capabilities.EXPORT_TXT,
    Capabilities.EXPORT_HTML
  ],
  [ContentType.MANGA]: [
    Capabilities.CONTENT_IMAGES,
    Capabilities.DOWNLOAD_SEQUENTIAL,
    Capabilities.EXPORT_CBZ,
    Capabilities.EXPORT_PDF
  ],
  [ContentType.ANIME]: [
    Capabilities.CONTENT_TORRENT,
    Capabilities.DOWNLOAD_TORRENT
  ]
};

/**
 * Content type display configuration
 */
export const ContentTypeDisplay = {
  [ContentType.NOVEL]: {
    icon: '📖',
    label: 'Novel',
    plural: 'Novels',
    color: 'cyan'
  },
  [ContentType.MANGA]: {
    icon: '📚',
    label: 'Manga',
    plural: 'Manga',
    color: 'magenta'
  },
  [ContentType.ANIME]: {
    icon: '🎬',
    label: 'Anime',
    plural: 'Anime',
    color: 'yellow'
  }
};

/**
 * Check if a source has a specific capability
 * @param {Object} source - Source configuration
 * @param {string} capability - Capability to check
 * @returns {boolean}
 */
export function hasCapability(source, capability) {
  if (!source || !source.capabilities) {
    return false;
  }
  return source.capabilities.includes(capability);
}

/**
 * Check if source has any of the given capabilities
 * @param {Object} source - Source configuration
 * @param {string[]} capabilities - Capabilities to check
 * @returns {boolean}
 */
export function hasAnyCapability(source, capabilities) {
  return capabilities.some(cap => hasCapability(source, cap));
}

/**
 * Check if source has all of the given capabilities
 * @param {Object} source - Source configuration
 * @param {string[]} capabilities - Capabilities to check
 * @returns {boolean}
 */
export function hasAllCapabilities(source, capabilities) {
  return capabilities.every(cap => hasCapability(source, cap));
}

/**
 * Get capabilities for a content type with search capabilities
 * @param {string} contentType - Content type
 * @param {Object} options - Additional options
 * @returns {string[]}
 */
export function getCapabilitiesForType(contentType, options = {}) {
  const caps = [...(ContentTypeDefaults[contentType] || [])];

  if (options.hasSearch) caps.push(Capabilities.SEARCH_TEXT);
  if (options.hasBrowse) caps.push(Capabilities.SEARCH_BROWSE);
  if (options.hasUrl !== false) caps.push(Capabilities.SEARCH_URL);

  return caps;
}

/**
 * Get display info for a content type
 * @param {string} contentType - Content type
 * @returns {Object}
 */
export function getContentTypeDisplay(contentType) {
  return ContentTypeDisplay[contentType] || ContentTypeDisplay[ContentType.NOVEL];
}

/**
 * Get search capabilities available for a source
 * @param {Object} source - Source configuration
 * @returns {string[]}
 */
export function getSearchCapabilities(source) {
  const searchCaps = [
    Capabilities.SEARCH_TEXT,
    Capabilities.SEARCH_BROWSE,
    Capabilities.SEARCH_URL
  ];
  return searchCaps.filter(cap => hasCapability(source, cap));
}

/**
 * Get export capabilities available for a source
 * @param {Object} source - Source configuration
 * @returns {string[]}
 */
export function getExportCapabilities(source) {
  const exportCaps = [
    Capabilities.EXPORT_EPUB,
    Capabilities.EXPORT_PDF,
    Capabilities.EXPORT_DOCX,
    Capabilities.EXPORT_TXT,
    Capabilities.EXPORT_CBZ,
    Capabilities.EXPORT_HTML
  ];
  return exportCaps.filter(cap => hasCapability(source, cap));
}

/**
 * Content item interface (for documentation/type hints)
 * @typedef {Object} ContentItem
 * @property {string} id - Unique identifier
 * @property {string} title - Content title
 * @property {string} url - Source URL
 * @property {string} [author] - Author/creator
 * @property {string} [cover] - Cover image URL
 * @property {string} [description] - Content description
 * @property {string[]} [genres] - Genre tags
 * @property {string} [status] - Publication status
 * @property {Object} [rating] - Rating info
 */

/**
 * Chapter/Episode interface
 * @typedef {Object} Chapter
 * @property {string} id - Unique identifier
 * @property {string} title - Chapter title
 * @property {string} url - Chapter URL
 * @property {number} [number] - Chapter number
 * @property {Date} [date] - Release date
 */

/**
 * Download state interface
 * @typedef {Object} DownloadState
 * @property {string} contentId - Content identifier
 * @property {string} contentType - Content type
 * @property {number} totalItems - Total chapters/episodes
 * @property {number} completedItems - Completed downloads
 * @property {number} failedItems - Failed downloads
 * @property {string} status - Current status
 * @property {Date} startedAt - Start time
 * @property {Date} [completedAt] - Completion time
 */

export default {
  ContentType,
  Capabilities,
  ContentTypeDefaults,
  ContentTypeDisplay,
  hasCapability,
  hasAnyCapability,
  hasAllCapabilities,
  getCapabilitiesForType,
  getContentTypeDisplay,
  getSearchCapabilities,
  getExportCapabilities
};
