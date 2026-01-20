/**
 * NovelFull.net Scraper
 * 
 * Searches for novels, fetches metadata and ALL chapters across pages.
 * Can download chapter content and save to files.
 */

import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';

const CONFIG = {
    baseUrl: 'https://novelfull.net',
    searchEndpoint: '/search',
    timeout: 15000,
    retryAttempts: 3,
    retryDelay: 1000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ============================================================================
// HTTP Client
// ============================================================================

async function fetchPage(url, attempt = 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': CONFIG.userAgent,
                'Accept': 'text/html,application/xhtml+xml',
            },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } catch (error) {
        clearTimeout(timeoutId);
        if (attempt < CONFIG.retryAttempts) {
            console.log(`  ⚠️  Attempt ${attempt} failed, retrying...`);
            await new Promise(r => setTimeout(r, CONFIG.retryDelay * attempt));
            return fetchPage(url, attempt + 1);
        }
        throw error;
    }
}

// ============================================================================
// Search Novels
// ============================================================================

async function searchNovels(query) {
    const url = `${CONFIG.baseUrl}${CONFIG.searchEndpoint}?keyword=${encodeURIComponent(query)}`;
    console.log(`\n🔍 Searching: "${query}"`);
    console.log(`   URL: ${url}\n`);

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

        const author = $el.find('.author').text().trim() || null;
        let cover = $el.find('img').attr('src');
        if (cover && !cover.startsWith('http')) cover = CONFIG.baseUrl + cover;

        novels.push({ title, url: href, author, cover });
    });

    return novels;
}

// ============================================================================
// Parse Chapters from a Single Page
// ============================================================================

function parseChaptersFromPage($) {
    const chapters = [];

    // Chapters are in: ul.list-chapter li a
    // Each has href and title attribute with full chapter name
    $('ul.list-chapter li a').each((_, el) => {
        const $a = $(el);
        
        // Get URL
        let chUrl = $a.attr('href');
        if (!chUrl) return;
        if (!chUrl.startsWith('http')) chUrl = CONFIG.baseUrl + chUrl;
        
        // Get title from the title attribute (most reliable) or text content
        const chTitle = $a.attr('title')?.trim() || $a.text().trim();
        if (!chTitle) return;

        // Extract chapter number from title or URL
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

// ============================================================================
// Get Total Pages for a Novel
// ============================================================================

function getTotalPages($) {
    // Look for pagination info
    // Hidden input: <input id="total-page" type="hidden" value="10">
    const totalPageInput = $('#total-page').val();
    if (totalPageInput) {
        return parseInt(totalPageInput) || 1;
    }

    // Fallback: look at pagination links
    let maxPage = 1;
    $('.pagination li a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/page=(\d+)/);
        if (match) {
            const pageNum = parseInt(match[1]);
            if (pageNum > maxPage) maxPage = pageNum;
        }
    });

    // Also check "Last" link text
    const lastText = $('.pagination li:last-child a').text();
    if (lastText && !isNaN(parseInt(lastText))) {
        const num = parseInt(lastText);
        if (num > maxPage) maxPage = num;
    }

    return maxPage;
}

// ============================================================================
// Get Novel Details + ALL Chapters (with pagination)
// ============================================================================

async function getNovelDetails(novelUrl) {
    console.log(`📖 Fetching novel details...`);
    console.log(`   URL: ${novelUrl}\n`);

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
    console.log(`   📄 Found ${totalPages} page(s) of chapters\n`);

    // Get chapters from first page
    let allChapters = parseChaptersFromPage($);
    console.log(`   Page 1: ${allChapters.length} chapters`);

    // Fetch remaining pages
    for (let page = 2; page <= totalPages; page++) {
        const pageUrl = `${novelUrl}?page=${page}`;
        try {
            await new Promise(r => setTimeout(r, 300)); // Rate limit
            const pageHtml = await fetchPage(pageUrl);
            const $page = cheerio.load(pageHtml);
            const pageChapters = parseChaptersFromPage($page);
            allChapters = allChapters.concat(pageChapters);
            console.log(`   Page ${page}: ${pageChapters.length} chapters`);
        } catch (err) {
            console.log(`   ⚠️  Page ${page} failed: ${err.message}`);
        }
    }

    // Deduplicate by URL
    const seen = new Set();
    const uniqueChapters = allChapters.filter(ch => {
        if (seen.has(ch.url)) return false;
        seen.add(ch.url);
        return true;
    });

    // Sort by chapter number (if available) or by order
    uniqueChapters.sort((a, b) => {
        if (a.number !== null && b.number !== null) return a.number - b.number;
        return 0;
    });

    // Assign sequential numbers if missing
    uniqueChapters.forEach((ch, idx) => {
        if (ch.number === null) ch.number = idx + 1;
    });

    console.log(`\n   ✅ Total unique chapters: ${uniqueChapters.length}\n`);

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
    };
}

// ============================================================================
// Get Chapter Content
// ============================================================================

async function getChapterContent(chapterUrl) {
    console.log(`   📄 Fetching chapter content...`);
    console.log(`      URL: ${chapterUrl}\n`);

    const html = await fetchPage(chapterUrl);
    return parseChapterContent(html);
}

function parseChapterContent(html) {
    const $ = cheerio.load(html);

    // Get chapter title
    const title = $('.chapter-title, .chapter-text h1, h1 a.chapter-title').first().text().trim() 
        || $('a.chapter-title').first().text().trim()
        || $('h2 a').first().text().trim();

    // Get content from #chapter-content or .chapter-c
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

    // If no paragraphs found, try getting all text
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

// ============================================================================
// Save Chapter to File
// ============================================================================

async function saveChapter(novelName, chapterNum, chapterTitle, content) {
    // Sanitize novel name for filesystem
    const safeName = novelName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
    
    const dir = path.join('data', safeName, 'chapters');
    await fs.mkdir(dir, { recursive: true });

    const filename = `chapter${chapterNum}.txt`;
    const filepath = path.join(dir, filename);

    await fs.writeFile(filepath, content, 'utf-8');
    
    console.log(`   ✅ Saved: ${filepath}`);
    return filepath;
}

// ============================================================================
// Save Novel Metadata
// ============================================================================

async function saveMetadata(novel) {
    const safeName = novel.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
    const dir = path.join('data', safeName);
    await fs.mkdir(dir, { recursive: true });

    const metaPath = path.join(dir, 'meta.json');
    await fs.writeFile(metaPath, JSON.stringify(novel, null, 2), 'utf-8');
    
    console.log(`   ✅ Saved metadata: ${metaPath}`);
    return metaPath;
}

// ============================================================================
// Pretty Print
// ============================================================================

function printSearchResults(novels) {
    console.log('═'.repeat(70));
    console.log('📚 SEARCH RESULTS');
    console.log('═'.repeat(70));
    
    if (novels.length === 0) {
        console.log('\n  No novels found.\n');
        return;
    }

    novels.forEach((novel, i) => {
        console.log(`\n  [${i + 1}] ${novel.title}`);
        if (novel.author) console.log(`      Author: ${novel.author}`);
        console.log(`      URL: ${novel.url}`);
    });
    console.log('\n' + '═'.repeat(70));
}

function printNovelDetails(novel) {
    console.log('\n' + '═'.repeat(70));
    console.log('📖 NOVEL DETAILS');
    console.log('═'.repeat(70));
    
    console.log(`\n  Title:       ${novel.title}`);
    console.log(`  Author:      ${novel.author}`);
    console.log(`  Genres:      ${novel.genres.join(', ')}`);
    console.log(`  Status:      ${novel.status}`);
    console.log(`  Source:      ${novel.source}`);
    if (novel.rating) console.log(`  Rating:      ${novel.rating}`);
    if (novel.cover) console.log(`  Cover:       ${novel.cover}`);
    console.log(`  URL:         ${novel.url}`);
    
    console.log(`\n  Description:`);
    const desc = novel.description || 'No description available.';
    const wrapped = desc.length > 300 ? desc.substring(0, 300) + '...' : desc;
    console.log(`  ${wrapped.replace(/\n/g, '\n  ')}`);

    console.log('\n' + '─'.repeat(70));
    console.log(`📑 CHAPTERS (${novel.totalChapters} total)`);
    console.log('─'.repeat(70));

    // Print first 15 chapters
    const firstChapters = novel.chapters.slice(0, 15);
    firstChapters.forEach(ch => {
        const num = String(ch.number).padStart(4);
        console.log(`  [${num}] ${ch.title}`);
        console.log(`         ${ch.url}`);
    });

    if (novel.chapters.length > 20) {
        console.log(`\n  ... ${novel.chapters.length - 20} more chapters ...\n`);
        
        // Print last 5 chapters
        novel.chapters.slice(-5).forEach(ch => {
            const num = String(ch.number).padStart(4);
            console.log(`  [${num}] ${ch.title}`);
            console.log(`         ${ch.url}`);
        });
    } else if (novel.chapters.length > 15) {
        novel.chapters.slice(15).forEach(ch => {
            const num = String(ch.number).padStart(4);
            console.log(`  [${num}] ${ch.title}`);
            console.log(`         ${ch.url}`);
        });
    }

    console.log('\n' + '═'.repeat(70));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    // ========================================
    // SET YOUR SEARCH QUERY HERE
    const query = 'rebirth of the thief';
    // ========================================

    try {
        // Step 1: Search
        const searchResults = await searchNovels(query);
        printSearchResults(searchResults);

        if (searchResults.length === 0) {
            console.log('No results found. Exiting.');
            return;
        }

        // Step 2: Pick first result
        const selected = searchResults[0];
        console.log(`\n✅ Auto-selecting first result: "${selected.title}"\n`);

        // Step 3: Get full details + ALL chapters (with pagination)
        const novelDetails = await getNovelDetails(selected.url);
        printNovelDetails(novelDetails);

        // Step 4: Save metadata
        await saveMetadata(novelDetails);

        // Step 5: Download and save first chapter
        if (novelDetails.chapters.length > 0) {
            const firstChapter = novelDetails.chapters[0];
            console.log(`\n📥 Downloading first chapter...\n`);
            
            const chapterContent = await getChapterContent(firstChapter.url);
            await saveChapter(
                novelDetails.title,
                firstChapter.number,
                firstChapter.title,
                chapterContent.content
            );
            
            console.log(`\n   Word count: ${chapterContent.wordCount}`);
        }

        // Return for programmatic use
        return novelDetails;

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        
        // Demo output if network fails
        console.log('\n📌 Network unavailable. Showing demo output...\n');
        await showDemo();
    }
}

main();

export { searchNovels, getNovelDetails, getChapterContent, saveChapter, saveMetadata, CONFIG };