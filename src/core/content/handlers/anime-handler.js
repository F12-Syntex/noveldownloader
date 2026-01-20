/**
 * Anime Content Handler
 * Handles anime-specific operations: search nyaa.si, download via torrent
 */

import { ContentType, Capabilities } from '../types.js';
import * as nyaa from '../../../nyaa.js';
import * as torrent from '../../../torrent.js';
import { log } from '../../../logger.js';

export class AnimeHandler {
  constructor() {
    this.contentType = ContentType.ANIME;
    this.capabilities = [
      Capabilities.SEARCH_TEXT,
      Capabilities.SEARCH_BROWSE,
      Capabilities.CONTENT_TORRENT,
      Capabilities.DOWNLOAD_TORRENT
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
    return source?.contentType === ContentType.ANIME || source?.torrentConfig;
  }

  /**
   * Get available categories for browsing
   * @param {Object} source - Source configuration
   * @returns {Object[]}
   */
  getCategories(source) {
    // Use source config if available, otherwise use nyaa defaults
    if (source?.browse?.categories) {
      return source.browse.categories;
    }

    return [
      { name: 'All Anime', value: nyaa.CATEGORIES.ANIME },
      { name: 'Anime - AMV', value: nyaa.CATEGORIES.ANIME_AMV },
      { name: 'English Translated', value: nyaa.CATEGORIES.ANIME_ENGLISH },
      { name: 'Non-English Translated', value: nyaa.CATEGORIES.ANIME_NON_ENGLISH },
      { name: 'Raw', value: nyaa.CATEGORIES.ANIME_RAW }
    ];
  }

  /**
   * Get available filters
   * @param {Object} source - Source configuration
   * @returns {Object[]}
   */
  getFilters(source) {
    if (source?.browse?.filters) {
      return source.browse.filters;
    }

    return [
      { name: 'No Filter', value: nyaa.FILTERS.NO_FILTER },
      { name: 'No Remakes', value: nyaa.FILTERS.NO_REMAKES },
      { name: 'Trusted Only', value: nyaa.FILTERS.TRUSTED_ONLY }
    ];
  }

  /**
   * Search for anime torrents
   * @param {string} query - Search query
   * @param {Object} source - Source configuration
   * @param {Object} options - Search options
   * @returns {Promise<Object[]>}
   */
  async search(query, source, options = {}) {
    const {
      category = nyaa.CATEGORIES.ANIME,
      filter = nyaa.FILTERS.NO_FILTER,
      page = 1,
      sortBy = 'seeders',
      sortOrder = 'desc'
    } = options;

    log.debug(`AnimeHandler: Searching for "${query}" in category ${category}`);

    const results = await nyaa.searchNyaa(query, {
      category,
      filter,
      page,
      sortBy,
      sortOrder
    });

    // Transform results to consistent format
    return results.map(r => ({
      id: r.id,
      title: r.title,
      url: r.detailUrl,
      magnetLink: r.magnetLink,
      torrentUrl: r.torrentUrl,
      size: r.size,
      sizeBytes: r.sizeBytes,
      seeders: r.seeders,
      leechers: r.leechers,
      downloads: r.downloads,
      date: r.date,
      trusted: r.trustLevel === 'trusted',
      remake: r.trustLevel === 'remake',
      episodes: r.episodes,
      isBatch: r.isBatch,
      category: r.category
    }));
  }

  /**
   * Get torrent details including file list
   * @param {string} torrentId - Torrent ID or magnet link
   * @param {Object} source - Source configuration
   * @returns {Promise<Object>}
   */
  async getDetails(torrentId, source) {
    log.debug(`AnimeHandler: Fetching details for ${torrentId}`);

    // If it's a magnet link, fetch files directly via WebTorrent
    if (torrentId.startsWith('magnet:')) {
      const torrentInfo = await torrent.getTorrentFiles(torrentId);
      return {
        id: torrentInfo.infoHash,
        title: torrentInfo.name,
        totalSize: torrentInfo.totalSize,
        totalSizeFormatted: torrentInfo.totalSizeFormatted,
        files: torrentInfo.files,
        torrent: torrentInfo.torrent,
        magnetLink: torrentId
      };
    }

    // Otherwise fetch from nyaa details page
    const details = await nyaa.getTorrentDetails(torrentId);

    return {
      id: details.id,
      title: details.title,
      description: details.description,
      magnetLink: details.magnetLink,
      torrentUrl: details.torrentUrl,
      info: details.info,
      files: details.files,
      fileCount: details.fileCount
    };
  }

  /**
   * Get torrent files from magnet link
   * @param {string} magnetLink - Magnet link
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<Object>}
   */
  async getTorrentFiles(magnetLink, timeout = 30000) {
    log.debug(`AnimeHandler: Fetching torrent files`);
    return await torrent.getTorrentFiles(magnetLink, timeout);
  }

  /**
   * Download selected files from torrent
   * @param {Object} torrentInfo - Torrent info from getTorrentFiles
   * @param {number[]} fileIndices - Indices of files to download
   * @param {Object} options - Download options
   * @returns {Promise<Object>}
   */
  async downloadFiles(torrentInfo, fileIndices, options = {}) {
    const {
      downloadDir,
      onProgress
    } = options;

    log.debug(`AnimeHandler: Downloading ${fileIndices.length} files`);

    return await torrent.downloadFiles(torrentInfo, fileIndices, {
      downloadDir,
      onProgress
    });
  }

  /**
   * Download entire torrent
   * @param {string} magnetLink - Magnet link
   * @param {Object} options - Download options
   * @returns {Promise<Object>}
   */
  async downloadTorrent(magnetLink, options = {}) {
    const {
      downloadDir,
      onProgress
    } = options;

    log.debug(`AnimeHandler: Downloading torrent`);

    return await torrent.downloadTorrent(magnetLink, {
      downloadDir,
      onProgress
    });
  }

  /**
   * Remove a torrent from the client
   * @param {string} infoHash - Torrent info hash
   */
  removeTorrent(infoHash) {
    return torrent.removeTorrent(infoHash);
  }

  /**
   * Get active downloads
   * @returns {Object[]}
   */
  getActiveDownloads() {
    return torrent.getActiveDownloads();
  }

  /**
   * Filter results by minimum seeders
   * @param {Object[]} results - Search results
   * @param {number} minSeeders - Minimum seeders
   * @returns {Object[]}
   */
  filterByMinSeeders(results, minSeeders = 1) {
    return results.filter(r => r.seeders >= minSeeders);
  }

  /**
   * Filter results by episodes
   * @param {Object[]} results - Search results
   * @param {number[]} targetEpisodes - Target episode numbers
   * @returns {Object[]}
   */
  filterByEpisodes(results, targetEpisodes) {
    if (!targetEpisodes || targetEpisodes.length === 0) {
      return results;
    }

    return results.filter(r => {
      if (r.isBatch && r.episodes && r.episodes.length > 0) {
        return targetEpisodes.some(ep => r.episodes.includes(ep));
      }
      if (r.episodes && r.episodes.length > 0) {
        return r.episodes.some(ep => targetEpisodes.includes(ep));
      }
      return true;
    });
  }

  /**
   * Filter results by trust level
   * @param {Object[]} results - Search results
   * @param {boolean} trustedOnly - Only show trusted
   * @param {boolean} noRemakes - Exclude remakes
   * @returns {Object[]}
   */
  filterByTrust(results, trustedOnly = false, noRemakes = false) {
    return results.filter(r => {
      if (trustedOnly && !r.trusted) return false;
      if (noRemakes && r.remake) return false;
      return true;
    });
  }

  /**
   * Parse episode range string
   * @param {string} rangeStr - Episode range (e.g., "1-5", "1,3,5")
   * @returns {number[]}
   */
  parseEpisodeRange(rangeStr) {
    return nyaa.parseEpisodeRange(rangeStr);
  }

  /**
   * Get video files from file list
   * @param {Object[]} files - File list
   * @returns {Object[]}
   */
  getVideoFiles(files) {
    return files.filter(f => nyaa.isVideoFile(f.name));
  }

  /**
   * Check if a file is a video
   * @param {string} filename - Filename
   * @returns {boolean}
   */
  isVideoFile(filename) {
    return nyaa.isVideoFile(filename);
  }

  /**
   * Check if search is supported
   * @param {Object} source - Source configuration
   * @returns {boolean}
   */
  supportsSearch(source) {
    return true; // Nyaa always supports search
  }

  /**
   * Check if browse is supported
   * @param {Object} source - Source configuration
   * @returns {boolean}
   */
  supportsBrowse(source) {
    return true; // Nyaa supports category browsing
  }

  /**
   * Cleanup - destroy torrent client
   */
  cleanup() {
    torrent.destroyClient();
  }
}

export default AnimeHandler;
