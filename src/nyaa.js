/**
 * Nyaa.si Search Module
 * Handles searching and parsing anime torrents from nyaa.si
 */

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { log } from './logger.js';

const NYAA_BASE_URL = 'https://nyaa.si';

// Categories
export const CATEGORIES = {
    ALL: '0_0',
    ANIME: '1_0',
    ANIME_AMV: '1_1',
    ANIME_ENGLISH: '1_2',
    ANIME_NON_ENGLISH: '1_3',
    ANIME_RAW: '1_4',
};

// Filters
export const FILTERS = {
    NO_FILTER: '0',
    NO_REMAKES: '1',
    TRUSTED_ONLY: '2',
};

/**
 * Parse file size string to bytes
 */
function parseSize(sizeStr) {
    if (!sizeStr) return 0;

    const match = sizeStr.match(/([\d.]+)\s*(GiB|MiB|KiB|TiB|GB|MB|KB|TB|B)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers = {
        'b': 1,
        'kib': 1024,
        'kb': 1000,
        'mib': 1024 * 1024,
        'mb': 1000 * 1000,
        'gib': 1024 * 1024 * 1024,
        'gb': 1000 * 1000 * 1000,
        'tib': 1024 * 1024 * 1024 * 1024,
        'tb': 1000 * 1000 * 1000 * 1000,
    };

    return Math.round(value * (multipliers[unit] || 1));
}

/**
 * Format bytes to human readable
 */
export function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Parse episode numbers from torrent title
 */
export function parseEpisodeFromTitle(title) {
    const episodes = [];

    // Match patterns like "- 01", "- 01-12", "Episode 1", "E01", "Ep 01", "01-12", "S01E01"
    const patterns = [
        /[-\s](\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?(?:\s*(?:END|Final|Complete))?(?:\s*[\[\(]|\s*$)/i,
        /Episode\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?/i,
        /\bE(?:p(?:isode)?)?\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?/i,
        /\bS\d{1,2}E(\d{1,4})(?:\s*[-~]\s*E?(\d{1,4}))?/i,
        /(?:^|\s)(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?(?:\s*(?:END|Final|Complete))?(?:\s*[\[\(])/i,
    ];

    for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match) {
            const start = parseInt(match[1]);
            const end = match[2] ? parseInt(match[2]) : start;

            // Sanity check - episode numbers shouldn't be too high for single episodes
            if (start <= 9999 && end <= 9999 && start <= end) {
                for (let i = start; i <= end; i++) {
                    if (!episodes.includes(i)) {
                        episodes.push(i);
                    }
                }
                break;
            }
        }
    }

    // Check for batch/complete indicators
    const isBatch = /batch|complete|全話|1-\d+|\d+-\d+/i.test(title);

    return { episodes, isBatch };
}

/**
 * Search nyaa.si for anime torrents
 */
export async function searchNyaa(query, options = {}) {
    const {
        category = CATEGORIES.ANIME,
        filter = FILTERS.NO_FILTER,
        page = 1,
        sortBy = 'seeders', // id, seeders, leechers, downloads, size, date
        sortOrder = 'desc',
    } = options;

    const params = new URLSearchParams({
        f: filter,
        c: category,
        q: query,
        p: page.toString(),
        s: sortBy,
        o: sortOrder,
    });

    const url = `${NYAA_BASE_URL}/?${params.toString()}`;
    log.debug(`Searching Nyaa: ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
            timeout: 15000,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        return parseSearchResults(html);

    } catch (error) {
        log.error('Nyaa search failed', { error: error.message, query });
        throw error;
    }
}

/**
 * Parse search results from HTML
 */
function parseSearchResults(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('table.torrent-list tbody tr').each((_, row) => {
        const $row = $(row);

        // Get category
        const categoryLink = $row.find('td:nth-child(1) a').attr('href') || '';
        const categoryMatch = categoryLink.match(/c=(\d+_\d+)/);
        const category = categoryMatch ? categoryMatch[1] : '';

        // Get title and links
        const titleCell = $row.find('td:nth-child(2)');
        const titleLink = titleCell.find('a:not(.comments)').last();
        const title = titleLink.text().trim();
        const detailUrl = titleLink.attr('href');
        const id = detailUrl ? detailUrl.replace('/view/', '') : '';

        // Get torrent/magnet links
        const linksCell = $row.find('td:nth-child(3)');
        const torrentLink = linksCell.find('a[href$=".torrent"]').attr('href');
        const magnetLink = linksCell.find('a[href^="magnet:"]').attr('href');

        // Get size
        const size = $row.find('td:nth-child(4)').text().trim();
        const sizeBytes = parseSize(size);

        // Get date
        const date = $row.find('td:nth-child(5)').text().trim();

        // Get seeders/leechers/downloads
        const seeders = parseInt($row.find('td:nth-child(6)').text().trim()) || 0;
        const leechers = parseInt($row.find('td:nth-child(7)').text().trim()) || 0;
        const downloads = parseInt($row.find('td:nth-child(8)').text().trim()) || 0;

        // Determine trust level from row class
        let trustLevel = 'default';
        if ($row.hasClass('success')) trustLevel = 'trusted';
        else if ($row.hasClass('danger')) trustLevel = 'remake';

        // Parse episode info from title
        const episodeInfo = parseEpisodeFromTitle(title);

        if (title && (torrentLink || magnetLink)) {
            results.push({
                id,
                title,
                category,
                detailUrl: detailUrl ? `${NYAA_BASE_URL}${detailUrl}` : null,
                torrentUrl: torrentLink ? `${NYAA_BASE_URL}${torrentLink}` : null,
                magnetLink,
                size,
                sizeBytes,
                date,
                seeders,
                leechers,
                downloads,
                trustLevel,
                episodes: episodeInfo.episodes,
                isBatch: episodeInfo.isBatch,
            });
        }
    });

    log.debug(`Found ${results.length} results`);
    return results;
}

/**
 * Get torrent details including file list
 */
export async function getTorrentDetails(torrentId) {
    const url = `${NYAA_BASE_URL}/view/${torrentId}`;
    log.debug(`Fetching torrent details: ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
            timeout: 15000,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        return parseDetailPage(html, torrentId);

    } catch (error) {
        log.error('Failed to get torrent details', { error: error.message, torrentId });
        throw error;
    }
}

/**
 * Parse torrent detail page
 */
function parseDetailPage(html, torrentId) {
    const $ = cheerio.load(html);

    const title = $('h3.panel-title').first().text().trim();

    // Get magnet link
    const magnetLink = $('a[href^="magnet:"]').attr('href');
    const torrentLink = $('a[href$=".torrent"]').attr('href');

    // Get info from the panel
    const info = {};
    $('.row .col-md-5').each((_, el) => {
        const label = $(el).text().trim().replace(':', '');
        const value = $(el).next('.col-md-7').text().trim();
        info[label.toLowerCase()] = value;
    });

    // Get description
    const description = $('#torrent-description').text().trim();

    // Get file list
    const files = [];
    $('.torrent-file-list li').each((_, el) => {
        const $li = $(el);
        const fileName = $li.find('.folder, i.fa-file').parent().text().trim() || $li.text().trim();
        const fileSize = $li.find('.file-size').text().trim();

        // Clean up file name (remove size from end if present)
        const cleanName = fileName.replace(/\s*\([\d.]+\s*[KMGT]i?B\)\s*$/, '').trim();

        if (cleanName && !cleanName.includes('...')) {
            files.push({
                name: cleanName,
                size: fileSize,
                sizeBytes: parseSize(fileSize),
            });
        }
    });

    // If no file list found, try alternate parsing
    if (files.length === 0) {
        // Sometimes files are in a different structure
        $('ul.torrent-file-list li.file-node').each((_, el) => {
            const name = $(el).find('.file-name').text().trim();
            const size = $(el).find('.file-size').text().trim();
            if (name) {
                files.push({
                    name,
                    size,
                    sizeBytes: parseSize(size),
                });
            }
        });
    }

    return {
        id: torrentId,
        title,
        magnetLink,
        torrentUrl: torrentLink ? `${NYAA_BASE_URL}${torrentLink}` : null,
        info,
        description: description.substring(0, 500),
        files,
        fileCount: files.length || parseInt(info['file size']) || 1,
    };
}

/**
 * Filter results by minimum seeders
 */
export function filterByMinSeeders(results, minSeeders = 1) {
    return results.filter(r => r.seeders >= minSeeders);
}

/**
 * Filter results by episode
 */
export function filterByEpisode(results, targetEpisodes) {
    if (!targetEpisodes || targetEpisodes.length === 0) {
        return results;
    }

    return results.filter(r => {
        // If torrent is a batch, check if it contains any target episodes
        if (r.isBatch && r.episodes.length > 0) {
            return targetEpisodes.some(ep => r.episodes.includes(ep));
        }

        // For single episode torrents
        if (r.episodes.length > 0) {
            return r.episodes.some(ep => targetEpisodes.includes(ep));
        }

        // If we couldn't parse episodes, include it anyway
        return true;
    });
}

/**
 * Parse episode range string like "1", "1,3,5", "1-5", "1-5,10,15-20"
 */
export function parseEpisodeRange(rangeStr) {
    if (!rangeStr || rangeStr.trim() === '') {
        return [];
    }

    const episodes = new Set();
    const parts = rangeStr.split(',').map(s => s.trim());

    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(s => parseInt(s.trim()));
            if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let i = start; i <= end; i++) {
                    episodes.add(i);
                }
            }
        } else {
            const num = parseInt(part);
            if (!isNaN(num)) {
                episodes.add(num);
            }
        }
    }

    return Array.from(episodes).sort((a, b) => a - b);
}

/**
 * Get video file extensions
 */
export function isVideoFile(filename) {
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.webm', '.mov', '.wmv', '.flv', '.m4v'];
    const lower = filename.toLowerCase();
    return videoExtensions.some(ext => lower.endsWith(ext));
}

/**
 * Filter files to only video files
 */
export function getVideoFiles(files) {
    return files.filter(f => isVideoFile(f.name));
}
