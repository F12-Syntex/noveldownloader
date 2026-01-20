/**
 * NovelFull.net Scraper Module
 * Handles searching, fetching novel details, and chapter content
 */

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { log } from './logger.js';

const CONFIG = {
    baseUrl: 'https://novelfull.net',
    searchEndpoint: '/search',
    timeout: 15000,
    retryAttempts: 3,
    retryDelay: 1000,
    rateLimit: 300, // ms between requests
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/**
 * Fetch a page with retry logic
 */
async function fetchPage(url, attempt = 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        log.debug(`Fetching: ${url}`, { attempt });

        const response = await fetch(url, {
            headers: {
                'User-Agent': CONFIG.userAgent,
                'Accept': 'text/html,application/xhtml+xml',
            },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
    } catch (error) {
        clearTimeout(timeoutId);

        if (attempt < CONFIG.retryAttempts) {
            log.warn(`Fetch attempt ${attempt} failed, retrying...`, { url, error: error.message });
            await new Promise(r => setTimeout(r, CONFIG.retryDelay * attempt));
            return fetchPage(url, attempt + 1);
        }

        log.error(`Failed to fetch after ${attempt} attempts`, { url, error: error.message });
        throw error;
    }
}

/**
 * Fetch an image as buffer
 */
export async function fetchImage(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': CONFIG.userAgent,
            },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return Buffer.from(await response.arrayBuffer());
    } catch (error) {
        clearTimeout(timeoutId);
        log.warn(`Failed to fetch image: ${url}`, { error: error.message });
        return null;
    }
}

/**
 * Search for novels by query
 */
export async function searchNovels(query) {
    const url = `${CONFIG.baseUrl}${CONFIG.searchEndpoint}?keyword=${encodeURIComponent(query)}`;
    log.debug(`Searching for: ${query}`);

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const novels = [];

    $('.list-truyen .row, .col-truyen-main .row').each((_, el) => {
        const $el = $(el);
        const titleLink = $el.find('.truyen-title a, h3 a').first();
        const title = titleLink.text().trim();
        let href = titleLink.attr('href');

        if (!title || !href) return;
        if (!href.startsWith('http')) href = CONFIG.baseUrl + href;

        const author = $el.find('.author').text().trim() || 'Unknown';
        let cover = $el.find('img').attr('src');
        if (cover && !cover.startsWith('http')) cover = CONFIG.baseUrl + cover;

        novels.push({ title, url: href, author, cover });
    });

    log.debug(`Found ${novels.length} results`);
    return novels;
}

/**
 * Parse chapters from a page
 */
function parseChaptersFromPage($) {
    const chapters = [];

    $('ul.list-chapter li a').each((_, el) => {
        const $a = $(el);
        let chUrl = $a.attr('href');
        if (!chUrl) return;
        if (!chUrl.startsWith('http')) chUrl = CONFIG.baseUrl + chUrl;

        const chTitle = $a.attr('title')?.trim() || $a.text().trim();
        if (!chTitle) return;

        // Extract chapter number
        let num = null;
        const titleMatch = chTitle.match(/chapter\s*(\d+)/i);
        const urlMatch = chUrl.match(/chapter-(\d+)/i);
        if (titleMatch) num = parseInt(titleMatch[1]);
        else if (urlMatch) num = parseInt(urlMatch[1]);

        chapters.push({
            number: num,
            title: chTitle,
            url: chUrl,
        });
    });

    return chapters;
}

/**
 * Get total pages for novel's chapter list
 */
function getTotalPages($) {
    let maxPage = 1;

    // Check the "Last" pagination link first (most reliable)
    const lastLink = $('.pagination li.last a').attr('href') || '';
    const lastMatch = lastLink.match(/page=(\d+)/);
    if (lastMatch) {
        maxPage = parseInt(lastMatch[1]);
    }

    // Also scan all pagination links
    $('.pagination li a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/page=(\d+)/);
        if (match) {
            const pageNum = parseInt(match[1]);
            if (pageNum > maxPage) maxPage = pageNum;
        }
    });

    // Fallback to hidden input only if no pagination found
    if (maxPage === 1) {
        const totalPageInput = $('#total-page').val();
        if (totalPageInput) {
            maxPage = parseInt(totalPageInput) || 1;
        }
    }

    return maxPage;
}

/**
 * Get full novel details including all chapters
 */
export async function getNovelDetails(novelUrl) {
    log.debug(`Fetching novel details from: ${novelUrl}`);

    const html = await fetchPage(novelUrl);
    const $ = cheerio.load(html);

    // Title
    const title = $('.title, h3.title').first().text().trim() || $('h1').first().text().trim();

    // Cover
    let cover = $('.book img, .info-holder img').first().attr('src');
    if (cover && !cover.startsWith('http')) cover = CONFIG.baseUrl + cover;

    // Author
    const author = $('a[href*="/author/"]').first().text().trim() || 'Unknown';

    // Genres
    const genres = [];
    $('a[href*="/genre/"]').each((_, el) => {
        const g = $(el).text().trim();
        if (g && !genres.includes(g)) genres.push(g);
    });

    // Status
    const statusText = $('a[href*="status"]').text() || '';
    const status = statusText.toLowerCase().includes('completed') ? 'Completed' : 'Ongoing';

    // Description
    const description = $('.desc-text, .description').first().text().trim();

    // Rating
    const ratingText = $('[itemprop="ratingValue"]').text();
    const ratingCount = $('[itemprop="ratingCount"]').text();
    const rating = ratingText ? `${ratingText}/10 from ${ratingCount} ratings` : null;

    // Get total pages
    const totalPages = getTotalPages($);
    log.debug(`Found ${totalPages} page(s) of chapters`);

    // Get chapters from first page
    let allChapters = parseChaptersFromPage($);
    log.debug(`Page 1: ${allChapters.length} chapters`);

    // Fetch remaining pages
    for (let page = 2; page <= totalPages; page++) {
        const pageUrl = `${novelUrl}?page=${page}`;
        try {
            await new Promise(r => setTimeout(r, CONFIG.rateLimit));
            const pageHtml = await fetchPage(pageUrl);
            const $page = cheerio.load(pageHtml);
            const pageChapters = parseChaptersFromPage($page);
            allChapters = allChapters.concat(pageChapters);
            log.debug(`Page ${page}: ${pageChapters.length} chapters`);
        } catch (err) {
            log.warn(`Page ${page} failed: ${err.message}`);
        }
    }

    // Deduplicate by URL
    const seen = new Set();
    const uniqueChapters = allChapters.filter(ch => {
        if (seen.has(ch.url)) return false;
        seen.add(ch.url);
        return true;
    });

    // Sort by chapter number
    uniqueChapters.sort((a, b) => {
        if (a.number !== null && b.number !== null) return a.number - b.number;
        return 0;
    });

    // Assign sequential numbers if missing
    uniqueChapters.forEach((ch, idx) => {
        if (ch.number === null) ch.number = idx + 1;
    });

    log.debug(`Total unique chapters: ${uniqueChapters.length}`);

    return {
        title,
        url: novelUrl,
        cover,
        author,
        genres,
        status,
        description,
        rating,
        source: 'NovelFull.net',
        totalChapters: uniqueChapters.length,
        chapters: uniqueChapters,
        fetchedAt: new Date().toISOString()
    };
}

/**
 * Get chapter content
 */
export async function getChapterContent(chapterUrl) {
    log.debug(`Fetching chapter: ${chapterUrl}`);

    const html = await fetchPage(chapterUrl);
    const $ = cheerio.load(html);

    // Get chapter title
    const title = $('.chapter-title, .chapter-text h1, h1 a.chapter-title').first().text().trim()
        || $('a.chapter-title').first().text().trim()
        || $('h2 a').first().text().trim();

    // Get content
    const contentEl = $('#chapter-content, .chapter-c').first();

    // Remove ads, scripts, iframes
    contentEl.find('script, iframe, .ads, [id*="ads"], [class*="ads"], div[align="center"]').remove();

    // Extract text from paragraphs
    const paragraphs = [];
    contentEl.find('p').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 0) {
            paragraphs.push(text);
        }
    });

    // Fallback to all text if no paragraphs
    let content = paragraphs.join('\n\n');
    if (!content) {
        content = contentEl.text().trim();
    }

    return {
        title,
        content,
        wordCount: content.split(/\s+/).length,
    };
}

export { CONFIG };
