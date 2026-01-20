/**
 * Novel Content Handler
 * Handles novel-specific operations: search, fetch details, download chapters
 */

import { ContentType, Capabilities } from '../types.js';
import * as scraper from '../../../scraper.js';
import { log } from '../../../logger.js';

export class NovelHandler {
  constructor() {
    this.contentType = ContentType.NOVEL;
    this.capabilities = [
      Capabilities.CONTENT_TEXT,
      Capabilities.DOWNLOAD_SEQUENTIAL,
      Capabilities.EXPORT_EPUB,
      Capabilities.EXPORT_PDF,
      Capabilities.EXPORT_DOCX,
      Capabilities.EXPORT_TXT,
      Capabilities.EXPORT_HTML
    ];
  }

  /**
   * Get the content type this handler supports
   */
  getContentType() {
    return this.contentType;
  }

  /**
   * Get capabilities this handler provides
   */
  getCapabilities() {
    return this.capabilities;
  }

  /**
   * Check if source is compatible with this handler
   */
  isCompatible(source) {
    return source?.contentType === ContentType.NOVEL ||
           (!source?.contentType && !source?.mangaDetails && !source?.torrentConfig);
  }

  /**
   * Search for novels
   * @param {string} query - Search query
   * @param {Object} source - Source configuration
   * @returns {Promise<Object[]>}
   */
  async search(query, source) {
    log.debug(`NovelHandler: Searching for "${query}"`);
    return await scraper.searchNovels(query, source);
  }

  /**
   * Browse novels by genre/category
   * @param {string} genreUrl - Genre URL path
   * @param {number} page - Page number
   * @param {Object} source - Source configuration
   * @returns {Promise<Object[]>}
   */
  async browse(genreUrl, page = 1, source) {
    log.debug(`NovelHandler: Browsing genre ${genreUrl}, page ${page}`);
    return await scraper.browseByGenre(genreUrl, page, source);
  }

  /**
   * Get available genres for browsing
   * @param {Object} source - Source configuration
   * @returns {Object[]}
   */
  getGenres(source) {
    return scraper.getGenres(source);
  }

  /**
   * Get novel details including chapter list
   * @param {string} url - Novel URL
   * @param {Object} source - Source configuration
   * @returns {Promise<Object>}
   */
  async getDetails(url, source) {
    log.debug(`NovelHandler: Fetching details for ${url}`);
    return await scraper.getNovelDetails(url, source);
  }

  /**
   * Get chapter content (text)
   * @param {string} chapterUrl - Chapter URL
   * @param {Object} source - Source configuration
   * @returns {Promise<Object>}
   */
  async getChapterContent(chapterUrl, source) {
    log.debug(`NovelHandler: Fetching chapter ${chapterUrl}`);
    const content = await scraper.getChapterContent(chapterUrl, source);

    // Ensure content type is marked as novel
    return {
      ...content,
      type: 'novel'
    };
  }

  /**
   * Download multiple chapters
   * @param {Object} novelInfo - Novel information with chapters
   * @param {number[]} chapterIndices - Indices of chapters to download
   * @param {Object} options - Download options
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>}
   */
  async downloadChapters(novelInfo, chapterIndices, options = {}, onProgress = null) {
    const { source } = options;
    const results = {
      total: chapterIndices.length,
      completed: 0,
      failed: 0,
      chapters: []
    };

    for (let i = 0; i < chapterIndices.length; i++) {
      const idx = chapterIndices[i];
      const chapter = novelInfo.chapters[idx];

      if (!chapter) {
        results.failed++;
        continue;
      }

      try {
        const content = await this.getChapterContent(chapter.url, source);

        results.chapters.push({
          ...chapter,
          content: content.content,
          wordCount: content.wordCount
        });
        results.completed++;

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: chapterIndices.length,
            chapter: chapter.title,
            status: 'success'
          });
        }

        // Rate limiting
        if (i < chapterIndices.length - 1) {
          await this.delay(options.rateLimit || 300);
        }
      } catch (error) {
        log.warn(`Failed to download chapter: ${chapter.title}`, { error: error.message });
        results.failed++;
        results.chapters.push({
          ...chapter,
          error: error.message
        });

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: chapterIndices.length,
            chapter: chapter.title,
            status: 'error',
            error: error.message
          });
        }
      }
    }

    return results;
  }

  /**
   * Check if search is supported
   * @param {Object} source - Source configuration
   * @returns {boolean}
   */
  supportsSearch(source) {
    return scraper.supportsSearch(source);
  }

  /**
   * Check if browse is supported
   * @param {Object} source - Source configuration
   * @returns {boolean}
   */
  supportsBrowse(source) {
    return scraper.supportsBrowse(source);
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default NovelHandler;
