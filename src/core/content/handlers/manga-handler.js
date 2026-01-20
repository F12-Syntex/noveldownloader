/**
 * Manga Content Handler
 * Handles manga-specific operations: search, fetch details, download chapters with images
 */

import { ContentType, Capabilities } from '../types.js';
import * as scraper from '../../../scraper.js';
import { log } from '../../../logger.js';

export class MangaHandler {
  constructor() {
    this.contentType = ContentType.MANGA;
    this.capabilities = [
      Capabilities.CONTENT_IMAGES,
      Capabilities.DOWNLOAD_SEQUENTIAL,
      Capabilities.EXPORT_CBZ,
      Capabilities.EXPORT_PDF
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
    return source?.contentType === ContentType.MANGA ||
           (source?.mangaDetails || source?.chapterContent?.type === 'images');
  }

  /**
   * Search for manga
   * @param {string} query - Search query
   * @param {Object} source - Source configuration
   * @returns {Promise<Object[]>}
   */
  async search(query, source) {
    log.debug(`MangaHandler: Searching for "${query}"`);
    return await scraper.searchNovels(query, source);
  }

  /**
   * Browse manga by genre/category
   * @param {string} genreUrl - Genre URL path
   * @param {number} page - Page number
   * @param {Object} source - Source configuration
   * @returns {Promise<Object[]>}
   */
  async browse(genreUrl, page = 1, source) {
    log.debug(`MangaHandler: Browsing genre ${genreUrl}, page ${page}`);
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
   * Get manga details including chapter list
   * @param {string} url - Manga URL
   * @param {Object} source - Source configuration
   * @returns {Promise<Object>}
   */
  async getDetails(url, source) {
    log.debug(`MangaHandler: Fetching details for ${url}`);
    return await scraper.getNovelDetails(url, source);
  }

  /**
   * Get chapter content (images)
   * @param {string} chapterUrl - Chapter URL
   * @param {Object} source - Source configuration
   * @returns {Promise<Object>}
   */
  async getChapterContent(chapterUrl, source) {
    log.debug(`MangaHandler: Fetching chapter ${chapterUrl}`);
    const content = await scraper.getChapterContent(chapterUrl, source);

    // Ensure content type is marked as manga
    return {
      ...content,
      type: 'manga'
    };
  }

  /**
   * Fetch a single image
   * @param {string} imageUrl - Image URL
   * @param {Object} source - Source configuration
   * @returns {Promise<Buffer|null>}
   */
  async fetchImage(imageUrl, source) {
    return await scraper.fetchImage(imageUrl, source);
  }

  /**
   * Download multiple chapters with their images
   * @param {Object} mangaInfo - Manga information with chapters
   * @param {number[]} chapterIndices - Indices of chapters to download
   * @param {Object} options - Download options
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>}
   */
  async downloadChapters(mangaInfo, chapterIndices, options = {}, onProgress = null) {
    const { source, downloadImages = true } = options;
    const results = {
      total: chapterIndices.length,
      completed: 0,
      failed: 0,
      chapters: []
    };

    for (let i = 0; i < chapterIndices.length; i++) {
      const idx = chapterIndices[i];
      const chapter = mangaInfo.chapters[idx];

      if (!chapter) {
        results.failed++;
        continue;
      }

      try {
        const content = await this.getChapterContent(chapter.url, source);

        const chapterResult = {
          ...chapter,
          images: content.images,
          pageCount: content.pageCount
        };

        // Optionally download images as buffers
        if (downloadImages && content.images && content.images.length > 0) {
          chapterResult.imageBuffers = [];

          for (let j = 0; j < content.images.length; j++) {
            const imageUrl = content.images[j];
            const imageBuffer = await this.fetchImage(imageUrl, source);

            if (imageBuffer) {
              chapterResult.imageBuffers.push({
                url: imageUrl,
                buffer: imageBuffer,
                index: j
              });
            }

            // Update progress for image download
            if (onProgress) {
              onProgress({
                current: i + 1,
                total: chapterIndices.length,
                chapter: chapter.title,
                status: 'downloading',
                imageProgress: {
                  current: j + 1,
                  total: content.images.length
                }
              });
            }

            // Rate limiting between images
            if (j < content.images.length - 1) {
              await this.delay(options.imageRateLimit || 100);
            }
          }
        }

        results.chapters.push(chapterResult);
        results.completed++;

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: chapterIndices.length,
            chapter: chapter.title,
            status: 'success'
          });
        }

        // Rate limiting between chapters
        if (i < chapterIndices.length - 1) {
          await this.delay(options.rateLimit || 500);
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
   * Download chapter images only (for storage/export)
   * @param {Object} chapter - Chapter with image URLs
   * @param {Object} source - Source configuration
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>}
   */
  async downloadChapterImages(chapter, source, onProgress = null) {
    if (!chapter.images || chapter.images.length === 0) {
      return { success: false, error: 'No images to download' };
    }

    const images = [];

    for (let i = 0; i < chapter.images.length; i++) {
      const imageUrl = chapter.images[i];
      const buffer = await this.fetchImage(imageUrl, source);

      if (buffer) {
        images.push({
          url: imageUrl,
          buffer,
          index: i,
          filename: `page_${String(i + 1).padStart(4, '0')}.jpg`
        });
      }

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: chapter.images.length,
          status: buffer ? 'success' : 'failed'
        });
      }

      // Rate limiting
      if (i < chapter.images.length - 1) {
        await this.delay(100);
      }
    }

    return {
      success: true,
      images,
      totalImages: chapter.images.length,
      downloadedImages: images.length
    };
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

export default MangaHandler;
