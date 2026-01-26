/**
 * Source-Agnostic Scraper Module
 * Handles searching, fetching novel details, and chapter content using source configurations
 */

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import puppeteerVanilla from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { log } from './logger.js';
import {
    getActiveSource,
    buildUrl,
    getHttpConfig,
    ensureAbsoluteUrl
} from './sourceManager.js';

// Add stealth plugin to puppeteer-extra
puppeteerExtra.use(StealthPlugin());

// Shared browser instance for Puppeteer
let browserInstance = null;
let browserUseStealth = false;

/**
 * Get or create browser instance
 */
async function getBrowser(source) {
    const useStealth = source?.http?.stealth || false;
    const headless = source?.http?.headless !== false; // default true

    // If stealth mode changed, close existing browser
    if (browserInstance && browserUseStealth !== useStealth) {
        await browserInstance.close();
        browserInstance = null;
    }

    if (!browserInstance) {
        const launcher = useStealth ? puppeteerExtra : puppeteerVanilla;
        const modeText = useStealth ? 'stealth mode' : 'standard mode';
        log.debug(`Starting browser in ${modeText}...`);

        browserInstance = await launcher.launch({
            headless: headless ? 'new' : false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080'
            ]
        });
        browserUseStealth = useStealth;
    }
    return browserInstance;
}

/**
 * Close browser instance
 */
export async function closeBrowser() {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}

/**
 * Wait for Cloudflare challenge to complete
 */
async function waitForCloudflare(page, timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const isCloudflare = await page.evaluate(() => {
            const bodyText = document.body?.innerText || '';
            return bodyText.includes('Verify you are human') ||
                   bodyText.includes('checking your browser') ||
                   bodyText.includes('Just a moment') ||
                   document.querySelector('iframe[src*="challenges.cloudflare.com"]') !== null;
        });

        if (!isCloudflare) {
            return true; // Not on Cloudflare page, we're good
        }

        log.debug('Waiting for Cloudflare challenge...');
        await new Promise(r => setTimeout(r, 2000));
    }

    log.warn('Cloudflare wait timeout');
    return false;
}

/**
 * Fetch a page using Puppeteer (for anti-bot sites)
 */
async function fetchPageWithPuppeteer(url, source, attempt = 1) {
    const config = getHttpConfig(source);
    const jsWaitTime = source.http?.jsWaitTime || 2000;
    const waitForCf = source.http?.waitForCloudflare || false;
    const cfTimeout = source.http?.cloudflareTimeout || 30000;

    try {
        log.debug(`Fetching with browser: ${url}`, { attempt });

        const browser = await getBrowser(source);
        const page = await browser.newPage();

        try {
            // Set viewport for realistic browsing
            await page.setViewport({ width: 1920, height: 1080 });

            await page.setUserAgent(config.userAgent);

            // Set extra headers for stealth mode
            if (source.http?.stealth) {
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                });
            }

            // Only intercept requests if not in stealth mode (can interfere with CF)
            if (!source.http?.stealth) {
                await page.setRequestInterception(true);
                page.on('request', r => {
                    if (['image', 'font', 'media'].includes(r.resourceType())) {
                        r.abort();
                    } else {
                        r.continue();
                    }
                });
            }

            await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeout });

            // Wait for Cloudflare if enabled
            if (waitForCf) {
                await waitForCloudflare(page, cfTimeout);
            }

            // Try to dismiss consent popup if present
            try {
                const consentButton = await page.$('.fc-cta-consent, .fc-button-label, button[aria-label*="consent"], .accept-cookies');
                if (consentButton) {
                    await consentButton.click();
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (e) {
                // Consent popup not found or couldn't click, continue anyway
            }

            // Wait for JS content
            await new Promise(r => setTimeout(r, jsWaitTime));

            // For chapter pages, wait for navigation links to be populated
            if (url.includes('/chapter')) {
                try {
                    await page.waitForFunction(() => {
                        const nextBtn = document.querySelector('a#next_chap');
                        const prevBtn = document.querySelector('a#prev_chap');
                        // Wait until at least one nav button has an href
                        return (nextBtn && nextBtn.href && !nextBtn.href.endsWith('#')) ||
                               (prevBtn && prevBtn.href && !prevBtn.href.endsWith('#'));
                    }, { timeout: 5000 });
                } catch (e) {
                    // Navigation might not exist (last chapter), continue anyway
                    log.debug('Navigation wait timeout - might be last chapter');
                }
            }

            const html = await page.content();
            return html;
        } finally {
            await page.close();
        }
    } catch (error) {
        if (attempt < config.retryAttempts) {
            log.warn(`Browser fetch attempt ${attempt} failed, retrying...`, { url, error: error.message });
            await new Promise(r => setTimeout(r, config.retryDelay * attempt));
            return fetchPageWithPuppeteer(url, source, attempt + 1);
        }

        log.error(`Failed to fetch after ${attempt} attempts`, { url, error: error.message });
        throw error;
    }
}

/**
 * Fetch a page with retry logic (standard fetch)
 */
async function fetchPageWithFetch(url, source, attempt = 1) {
    const config = getHttpConfig(source);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
        log.debug(`Fetching: ${url}`, { attempt });

        const response = await fetch(url, {
            headers: {
                'User-Agent': config.userAgent,
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

        if (attempt < config.retryAttempts) {
            log.warn(`Fetch attempt ${attempt} failed, retrying...`, { url, error: error.message });
            await new Promise(r => setTimeout(r, config.retryDelay * attempt));
            return fetchPageWithFetch(url, source, attempt + 1);
        }

        log.error(`Failed to fetch after ${attempt} attempts`, { url, error: error.message });
        throw error;
    }
}

/**
 * Fetch a page - uses Puppeteer or fetch based on source config
 */
async function fetchPage(url, source, attempt = 1) {
    if (source.http?.usePuppeteer) {
        return fetchPageWithPuppeteer(url, source, attempt);
    }
    return fetchPageWithFetch(url, source, attempt);
}

/**
 * Fetch a page with Puppeteer and perform interactions (click tabs, etc.)
 * Returns the HTML after interactions complete
 */
async function fetchPageWithInteractions(url, source, interactions = {}) {
    const config = getHttpConfig(source);
    const jsWaitTime = source.http?.jsWaitTime || 2000;
    const waitForCf = source.http?.waitForCloudflare || false;
    const cfTimeout = source.http?.cloudflareTimeout || 30000;

    log.debug(`Fetching with interactions: ${url}`);

    const browser = await getBrowser(source);
    const page = await browser.newPage();

    try {
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent(config.userAgent);

        if (source.http?.stealth) {
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            });
        }

        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeout });

        // Wait for Cloudflare if enabled
        if (waitForCf) {
            await waitForCloudflare(page, cfTimeout);
        }

        // Initial wait for JS content
        await new Promise(r => setTimeout(r, jsWaitTime));

        // Click on chapter list tab if specified
        if (interactions.clickTabSelector) {
            // Handle comma-separated selectors
            const tabSelectors = interactions.clickTabSelector.includes(',')
                ? interactions.clickTabSelector.split(',').map(s => s.trim())
                : [interactions.clickTabSelector];

            for (const selector of tabSelectors) {
                try {
                    const tabButton = await page.$(selector);
                    if (tabButton) {
                        log.debug(`Clicking tab: ${selector}`);
                        await tabButton.click();
                        await new Promise(r => setTimeout(r, 1500)); // Wait for tab content to load
                        break; // Successfully clicked, stop trying
                    }
                } catch (e) {
                    log.debug(`Tab click failed for ${selector}: ${e.message}`);
                }
            }
        }

        // Wait for a specific selector if specified
        if (interactions.waitForSelector) {
            // Handle comma-separated selectors - try each one
            const selectors = interactions.waitForSelector.includes(',')
                ? interactions.waitForSelector.split(',').map(s => s.trim())
                : [interactions.waitForSelector];

            for (const selector of selectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    log.debug(`Found selector: ${selector}`);
                    break; // Found one, stop waiting
                } catch (e) {
                    log.debug(`Selector not found: ${selector}`);
                }
            }
        }

        const html = await page.content();
        return html;
    } finally {
        await page.close();
    }
}

/**
 * Fetch an image as buffer
 */
export async function fetchImage(url, source = null) {
    source = source || getActiveSource();
    if (!source) {
        throw new Error('No active source configured');
    }

    const config = getHttpConfig(source);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': config.userAgent,
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
 * Check if a URL value is valid (not a data: URL or empty)
 */
function isValidImageUrl(value) {
    if (!value) return false;
    if (value.startsWith('data:')) return false;
    return true;
}

/**
 * Extract a field value from an element using source configuration
 */
function extractField($, el, fieldConfig, baseUrl) {
    const $el = $(el);

    // Handle both array and comma-separated selectors
    let selectors;
    if (Array.isArray(fieldConfig.selector)) {
        selectors = fieldConfig.selector;
    } else if (typeof fieldConfig.selector === 'string' && fieldConfig.selector.includes(',')) {
        // Split comma-separated selectors
        selectors = fieldConfig.selector.split(',').map(s => s.trim());
    } else {
        selectors = [fieldConfig.selector];
    }

    const isUrlAttr = ['src', 'data-src', 'href'].includes(fieldConfig.attribute);

    for (const selector of selectors) {
        const target = selector ? $el.find(selector).first() : $el;
        if (target.length === 0) continue;

        let value;
        switch (fieldConfig.attribute) {
            case 'text':
                value = target.text().trim();
                break;
            case 'html':
                value = target.html();
                break;
            default:
                value = target.attr(fieldConfig.attribute);
                // Skip data: URLs for image src attributes - try fallback
                if (isUrlAttr && !isValidImageUrl(value) && fieldConfig.fallback && fieldConfig.fallback !== 'text') {
                    value = target.attr(fieldConfig.fallback);
                }
                // Make URL absolute
                if (isUrlAttr && isValidImageUrl(value)) {
                    value = ensureAbsoluteUrl(value, baseUrl);
                }
        }

        // For URL attributes, ensure it's a valid URL
        if (isUrlAttr) {
            if (isValidImageUrl(value)) {
                return value;
            }
        } else if (value) {
            // Apply transform if specified
            if (fieldConfig.transform === 'status') {
                value = value.toLowerCase().includes('completed') ? 'Completed' : 'Ongoing';
            }
            return value;
        }
    }

    // Check for fallback on the found target
    if (fieldConfig.fallback) {
        const target = selectors[0] ? $el.find(selectors[0]).first() : $el;
        if (target.length > 0) {
            const fallbackValue = fieldConfig.fallback === 'text'
                ? target.text().trim()
                : target.attr(fieldConfig.fallback);
            if (fallbackValue) {
                if (isUrlAttr && isValidImageUrl(fallbackValue)) {
                    return ensureAbsoluteUrl(fallbackValue, baseUrl);
                } else if (!isUrlAttr) {
                    return fallbackValue;
                }
            }
        }
    }

    return fieldConfig.default || null;
}

/**
 * Extract multiple field values from elements
 */
function extractMultipleFields($, container, fieldConfig, baseUrl) {
    const values = [];
    const selector = fieldConfig.selector;

    $(container).find(selector).each((_, el) => {
        let value;
        switch (fieldConfig.attribute) {
            case 'text':
                value = $(el).text().trim();
                break;
            default:
                value = $(el).attr(fieldConfig.attribute);
                if (fieldConfig.attribute === 'href' || fieldConfig.attribute === 'src') {
                    value = ensureAbsoluteUrl(value, baseUrl);
                }
        }
        if (value && !values.includes(value)) {
            values.push(value);
        }
    });

    return values;
}

/**
 * Search for novels by query
 */
export async function searchNovels(query, source = null) {
    source = source || getActiveSource();
    if (!source) {
        throw new Error('No active source configured');
    }

    const searchConfig = source.search;
    const url = buildUrl(searchConfig.url, {
        baseUrl: source.baseUrl,
        query: query
    });

    log.debug(`Searching for: ${query} on ${source.name}`);

    const html = await fetchPage(url, source);
    const $ = cheerio.load(html);
    const novels = [];

    $(searchConfig.resultSelector).each((_, el) => {
        const novel = {};

        for (const [fieldName, fieldConfig] of Object.entries(searchConfig.fields)) {
            novel[fieldName] = extractField($, el, fieldConfig, source.baseUrl);
        }

        // Skip if no title or URL
        if (!novel.title || !novel.url) return;

        // Ensure URL is absolute
        novel.url = ensureAbsoluteUrl(novel.url, source.baseUrl);
        if (novel.cover) {
            novel.cover = ensureAbsoluteUrl(novel.cover, source.baseUrl);
        }

        novels.push(novel);
    });

    log.debug(`Found ${novels.length} results`);
    return novels;
}

/**
 * Parse chapters from a page using source configuration
 */
function parseChaptersFromPage($, source) {
    const chapters = [];
    const chapterConfig = source.chapterList;

    $(chapterConfig.containerSelector).each((_, el) => {
        const $a = $(el);
        let chUrl = $a.attr(chapterConfig.fields.url.attribute || 'href');
        if (!chUrl) return;
        chUrl = ensureAbsoluteUrl(chUrl, source.baseUrl);

        // Get title from configured attribute with fallback
        let chTitle = $a.attr(chapterConfig.fields.title.attribute);
        if (!chTitle && chapterConfig.fields.title.fallback) {
            chTitle = chapterConfig.fields.title.fallback === 'text'
                ? $a.text().trim()
                : $a.attr(chapterConfig.fields.title.fallback);
        }
        if (!chTitle) chTitle = $a.text().trim();
        if (!chTitle) return;

        // Extract chapter number
        let num = null;
        if (chapterConfig.chapterNumberPattern) {
            const titleMatch = chTitle.match(new RegExp(chapterConfig.chapterNumberPattern, 'i'));
            if (titleMatch) num = parseInt(titleMatch[1]);
        }
        if (num === null && chapterConfig.chapterNumberUrlPattern) {
            const urlMatch = chUrl.match(new RegExp(chapterConfig.chapterNumberUrlPattern, 'i'));
            if (urlMatch) num = parseInt(urlMatch[1]);
        }

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
function getTotalPages($, source) {
    const pagination = source.chapterList.pagination;
    if (!pagination) return 1;

    let maxPage = 1;

    // Check the "Last" pagination link first (most reliable)
    if (pagination.lastPageSelector) {
        const lastLink = $(pagination.lastPageSelector).attr('href') || '';
        const lastMatch = lastLink.match(new RegExp(`${pagination.param}=(\\d+)`));
        if (lastMatch) {
            maxPage = parseInt(lastMatch[1]);
        }
    }

    // Also scan all pagination links
    if (pagination.pageLinksSelector) {
        $(pagination.pageLinksSelector).each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(new RegExp(`${pagination.param}=(\\d+)`));
            if (match) {
                const pageNum = parseInt(match[1]);
                if (pageNum > maxPage) maxPage = pageNum;
            }
        });
    }

    // Fallback to hidden input only if no pagination found
    if (maxPage === 1 && pagination.totalPagesInputSelector) {
        const totalPageInput = $(pagination.totalPagesInputSelector).val();
        if (totalPageInput) {
            maxPage = parseInt(totalPageInput) || 1;
        }
    }

    return maxPage;
}

/**
 * Get full novel details including all chapters
 */
export async function getNovelDetails(novelUrl, source = null) {
    source = source || getActiveSource();
    if (!source) {
        throw new Error('No active source configured');
    }

    log.debug(`Fetching novel details from: ${novelUrl}`);

    // Check if we need to click a tab to reveal chapters
    const chapterListConfig = source.chapterList;
    const needsInteraction = source.http?.usePuppeteer && chapterListConfig?.chapterListTabSelector;

    let html;
    if (needsInteraction) {
        // Use interactive fetch to click chapter tab
        html = await fetchPageWithInteractions(novelUrl, source, {
            clickTabSelector: chapterListConfig.chapterListTabSelector,
            waitForSelector: chapterListConfig.containerSelector || chapterListConfig.firstChapterSelector
        });
    } else {
        html = await fetchPage(novelUrl, source);
    }

    const $ = cheerio.load(html);

    const detailsConfig = source.novelDetails;
    const details = {};

    // Extract each field from configuration
    for (const [fieldName, fieldConfig] of Object.entries(detailsConfig.fields)) {
        if (fieldConfig.multiple) {
            details[fieldName] = extractMultipleFields($, 'body', fieldConfig, source.baseUrl);
        } else {
            details[fieldName] = extractField($, 'body', fieldConfig, source.baseUrl);
        }
    }

    // Build rating string if rating values exist
    let rating = null;
    if (details.ratingValue) {
        rating = `${details.ratingValue}/10`;
        if (details.ratingCount) {
            rating += ` from ${details.ratingCount} ratings`;
        }
    }
    delete details.ratingValue;
    delete details.ratingCount;

    // Ensure cover is absolute URL
    if (details.cover) {
        details.cover = ensureAbsoluteUrl(details.cover, source.baseUrl);
    }

    const isSequential = chapterListConfig.mode === 'sequential';

    let uniqueChapters = [];
    let firstChapterUrl = null;

    if (isSequential) {
        // Sequential mode: just get the first chapter URL
        // Try each selector until we find one that works
        const selectors = chapterListConfig.firstChapterSelector.includes(',')
            ? chapterListConfig.firstChapterSelector.split(',').map(s => s.trim())
            : [chapterListConfig.firstChapterSelector];

        for (const selector of selectors) {
            const firstChapterEl = $(selector).first();
            const href = firstChapterEl.attr('href');
            console.log(`[DEBUG] Trying selector "${selector}": found=${firstChapterEl.length > 0}, href="${href}"`);
            if (href && href !== '#' && !href.startsWith('javascript:')) {
                firstChapterUrl = ensureAbsoluteUrl(href, source.baseUrl);
                break;
            }
        }
        console.log(`[DEBUG] First chapter URL: ${firstChapterUrl}`);
    } else {
        // List mode: get all chapters upfront
        const totalPages = getTotalPages($, source);
        log.debug(`Found ${totalPages} page(s) of chapters`);

        // Get chapters from first page
        let allChapters = parseChaptersFromPage($, source);
        log.debug(`Page 1: ${allChapters.length} chapters`);

        // Fetch remaining pages
        const config = getHttpConfig(source);
        const pagination = chapterListConfig.pagination;

        if (pagination) {
            for (let page = 2; page <= totalPages; page++) {
                let pageUrl;
                if (pagination.type === 'query') {
                    const separator = novelUrl.includes('?') ? '&' : '?';
                    pageUrl = `${novelUrl}${separator}${pagination.param}=${page}`;
                } else {
                    pageUrl = `${novelUrl}/${page}`;
                }

                try {
                    await new Promise(r => setTimeout(r, config.rateLimit));
                    const pageHtml = await fetchPage(pageUrl, source);
                    const $page = cheerio.load(pageHtml);
                    const pageChapters = parseChaptersFromPage($page, source);
                    allChapters = allChapters.concat(pageChapters);
                    log.debug(`Page ${page}: ${pageChapters.length} chapters`);
                } catch (err) {
                    log.warn(`Page ${page} failed: ${err.message}`);
                }
            }
        }

        // Deduplicate by URL
        const seen = new Set();
        uniqueChapters = allChapters.filter(ch => {
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
    }

    // Debug: log what we extracted
    console.log(`[DEBUG] Extracted title: "${details.title}"`);
    console.log(`[DEBUG] First chapter URL: "${firstChapterUrl}"`);

    return {
        title: details.title,
        url: novelUrl,
        cover: details.cover,
        author: details.author || 'Unknown',
        genres: details.genres || [],
        status: details.status || 'Unknown',
        description: details.description,
        rating,
        source: source.name,
        sourceId: source.id,
        isSequential,
        firstChapterUrl,
        totalChapters: isSequential ? null : uniqueChapters.length,
        chapters: uniqueChapters,
        fetchedAt: new Date().toISOString()
    };
}

/**
 * Get chapter content
 */
export async function getChapterContent(chapterUrl, source = null) {
    source = source || getActiveSource();
    if (!source) {
        throw new Error('No active source configured');
    }

    log.debug(`Fetching chapter: ${chapterUrl}`);

    const html = await fetchPage(chapterUrl, source);
    const $ = cheerio.load(html);

    const contentConfig = source.chapterContent;

    // Get chapter title - try each selector in order
    let title = '';
    for (const selector of contentConfig.titleSelectors) {
        title = $(selector).first().text().trim();
        if (title) break;
    }

    // Get content element
    const contentEl = $(contentConfig.contentSelector).first();

    // Remove unwanted elements
    for (const removeSelector of contentConfig.removeSelectors) {
        contentEl.find(removeSelector).remove();
    }

    // Extract text from paragraphs
    const paragraphs = [];
    const paragraphSelector = contentConfig.paragraphSelector || 'p';

    contentEl.find(paragraphSelector).each((_, el) => {
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

    // Get navigation URLs for sequential mode
    let nextChapterUrl = null;
    let prevChapterUrl = null;

    if (contentConfig.navigation) {
        const nav = contentConfig.navigation;

        if (nav.nextSelector) {
            const nextEl = $(nav.nextSelector).first();
            const nextHref = nextEl.attr('href');
            const isDisabled = nextEl.hasClass('disabled') || nextEl.attr('disabled');
            const hasNoClass = nextEl.hasClass('ismark'); // Some sites use this to mark unavailable

            // Visible logging for debugging
            console.log(`  [NAV] Next button: found=${nextEl.length > 0}, href="${nextHref}", disabled=${isDisabled}`);

            // Check for valid URL
            const isValidHref = nextHref &&
                nextHref !== '#' &&
                nextHref !== '' &&
                !nextHref.startsWith('javascript:') &&
                !nextHref.includes('undefined') &&
                nextHref !== chapterUrl; // Not self-referencing

            if (isValidHref && !isDisabled && !hasNoClass) {
                nextChapterUrl = ensureAbsoluteUrl(nextHref, source.baseUrl);
                console.log(`  [NAV] Next URL: ${nextChapterUrl}`);
            } else if (nextEl.length > 0) {
                console.log(`  [NAV] Next button exists but invalid: href="${nextHref}", disabled=${isDisabled}, valid=${isValidHref}`);
            }
        }

        if (nav.prevSelector) {
            const prevEl = $(nav.prevSelector).first();
            const prevHref = prevEl.attr('href');
            if (prevHref && prevHref !== '#' && !prevHref.startsWith('javascript:') &&
                !prevEl.hasClass('disabled') && !prevEl.attr('disabled')) {
                prevChapterUrl = ensureAbsoluteUrl(prevHref, source.baseUrl);
            }
        }
    }

    log.debug(`Navigation: next="${nextChapterUrl}", prev="${prevChapterUrl}"`);

    return {
        title,
        content,
        wordCount: content.split(/\s+/).length,
        nextChapterUrl,
        prevChapterUrl,
    };
}

// Re-export for backward compatibility
export function getConfig() {
    const source = getActiveSource();
    if (!source) return null;
    return getHttpConfig(source);
}
