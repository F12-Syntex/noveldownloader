/**
 * Content Handler Registry
 * Manages content handlers for different content types
 */

import { ContentType } from './types.js';
import { log } from '../../logger.js';

// Handler registry
const handlers = new Map();

/**
 * Register a content handler
 * @param {string} contentType - Content type this handler supports
 * @param {Object} handler - Handler instance
 */
export function registerHandler(contentType, handler) {
  handlers.set(contentType, handler);
  log.debug(`Registered handler for content type: ${contentType}`);
}

/**
 * Get handler for a content type
 * @param {string} contentType - Content type
 * @returns {Object|null}
 */
export function getHandler(contentType) {
  return handlers.get(contentType) || null;
}

/**
 * Get handler for a source
 * @param {Object} source - Source configuration
 * @returns {Object|null}
 */
export function getHandlerForSource(source) {
  if (!source) return null;
  const contentType = source.contentType || ContentType.NOVEL;
  return getHandler(contentType);
}

/**
 * Check if a handler is registered for a content type
 * @param {string} contentType - Content type
 * @returns {boolean}
 */
export function hasHandler(contentType) {
  return handlers.has(contentType);
}

/**
 * Get all registered content types
 * @returns {string[]}
 */
export function getRegisteredTypes() {
  return Array.from(handlers.keys());
}

/**
 * Initialize all handlers
 * This should be called during app startup
 */
export async function initializeHandlers() {
  // Import handlers dynamically to avoid circular dependencies
  const [
    { NovelHandler },
    { MangaHandler },
    { AnimeHandler }
  ] = await Promise.all([
    import('./handlers/novel-handler.js'),
    import('./handlers/manga-handler.js'),
    import('./handlers/anime-handler.js')
  ]);

  // Register handlers
  registerHandler(ContentType.NOVEL, new NovelHandler());
  registerHandler(ContentType.MANGA, new MangaHandler());
  registerHandler(ContentType.ANIME, new AnimeHandler());

  log.info(`Initialized ${handlers.size} content handlers`);
}

// Re-export types
export * from './types.js';

export default {
  registerHandler,
  getHandler,
  getHandlerForSource,
  hasHandler,
  getRegisteredTypes,
  initializeHandlers
};
