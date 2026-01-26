/**
 * Novel Scraper Tester
 * Usage: node tester.js <search-query>
 * 
 * Uses puppeteer-extra with stealth plugin to bypass Cloudflare
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// ==================== CONFIGURATION ====================

const CONFIG = {
    baseUrl: "https://novelbin.me",
    http: {
        timeout: 60000,
        rateLimit: 2000,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    selectors: {
        search: {
            url: "/search?keyword=",
            results: "div#list-page div.archive div.list > div:not(.header-list)",
            title: "h3.novel-title a",
            novelUrl: "h3.novel-title a"
        },
        details: {
            title: "div.desc h3.title",
            author: "ul.info li a[href*='novelbin-author']",
            genres: "ul.info li a[href*='novelbin-genres']",
            status: "ul.info li a.text-primary",
            description: "div#tab-description div.desc-text",
            chapterListTab: "a#tab-chapters-title",
            firstChapter: "div#list-chapter ul.list-chapter li:first-child a",
            allChapters: "div#list-chapter ul.list-chapter li a"
        },
        chapter: {
            title: "h2 span.chr-text, h2 a.chr-title span.chr-text, div#chr-content h4",
            content: "div#chr-content",
            nextButton: "a#next_chap",
            prevButton: "a#prev_chap",
            removeElements: ["div[id^='pf-']", "script", "style", ".ads", "h4", "iframe", "noscript"]
        }
    },
    maxChaptersToTest: 5
};

// ==================== SCRAPER CLASS ====================

class NovelTester {
    constructor() {
        this.browser = null;
        this.page = null;
        this.lastRequestTime = 0;
        this.screenshotDir = './screenshots';
        this.screenshotCount = 0;
    }

    async init() {
        console.log('🚀 Launching browser with stealth mode...\n');
        
        // Create screenshots directory
        const fs = await import('fs/promises');
        try {
            await fs.mkdir(this.screenshotDir, { recursive: true });
            const files = await fs.readdir(this.screenshotDir);
            for (const file of files) {
                await fs.unlink(`${this.screenshotDir}/${file}`);
            }
        } catch (e) {}

        this.browser = await puppeteer.launch({
            headless: false, // Use headed mode to help with Cloudflare
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080'
            ]
        });

        this.page = await this.browser.newPage();
        
        // Set a realistic viewport
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        // Set extra headers to look more like a real browser
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });

        console.log('✅ Browser ready with stealth mode.\n');
    }

    async screenshot(name) {
        this.screenshotCount++;
        const filename = `${this.screenshotDir}/${String(this.screenshotCount).padStart(2, '0')}_${name}.png`;
        await this.page.screenshot({ path: filename, fullPage: true });
        console.log(`  📸 Screenshot saved: ${filename}`);
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async rateLimit() {
        const elapsed = Date.now() - this.lastRequestTime;
        if (elapsed < CONFIG.http.rateLimit) {
            await this.sleep(CONFIG.http.rateLimit - elapsed);
        }
        this.lastRequestTime = Date.now();
    }

    async goto(url) {
        await this.rateLimit();
        console.log(`📡 Navigating to: ${url}\n`);
        
        await this.page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.http.timeout
        });
        
        // Wait and check for Cloudflare
        await this.waitForCloudflare();
        
        await this.sleep(1000);
    }

    async waitForCloudflare() {
        // Check if we hit Cloudflare challenge
        const maxWait = 30000; // 30 seconds max wait
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait) {
            const isCloudflare = await this.page.evaluate(() => {
                return document.body?.innerText?.includes('Verify you are human') ||
                       document.body?.innerText?.includes('checking your browser') ||
                       document.querySelector('iframe[src*="challenges.cloudflare.com"]') !== null;
            });
            
            if (!isCloudflare) {
                return; // Not on Cloudflare page, we're good
            }
            
            console.log('  ⏳ Waiting for Cloudflare challenge to complete...');
            await this.sleep(2000);
        }
        
        console.log('  ⚠️ Cloudflare wait timeout - taking screenshot');
        await this.screenshot('cloudflare_timeout');
    }

    resolveUrl(url) {
        if (!url) return null;
        
        // Keep URLs on novelbin.me
        if (url.includes('novelbin.com/b/')) {
            url = url.replace('novelbin.com/b/', 'novelbin.me/novel-book/');
        }
        if (url.includes('novelbin.net/b/')) {
            url = url.replace('novelbin.net/b/', 'novelbin.me/novel-book/');
        }
        
        if (url.startsWith('http://')) {
            url = url.replace('http://', 'https://');
        }
        
        if (url.startsWith('https://')) return url;
        return new URL(url, CONFIG.baseUrl).href;
    }

    // ==================== STEP 1: SEARCH ====================

    async search(query) {
        query = query.trim().replace(/[\r\n]+/g, ' ');
        
        console.log('═'.repeat(60));
        console.log(`🔍 STEP 1: Searching for "${query}"`);
        console.log('═'.repeat(60) + '\n');

        const searchUrl = CONFIG.baseUrl + CONFIG.selectors.search.url + encodeURIComponent(query);
        await this.goto(searchUrl);
        await this.screenshot('search_results');

        const results = await this.page.evaluate((selectors) => {
            const items = document.querySelectorAll(selectors.results);
            return Array.from(items).map(item => {
                const titleEl = item.querySelector(selectors.title);
                const urlEl = item.querySelector(selectors.novelUrl);
                return {
                    title: titleEl?.textContent?.trim(),
                    url: urlEl?.getAttribute('href')
                };
            }).filter(r => r.title && r.url);
        }, CONFIG.selectors.search);

        console.log(`📚 Found ${results.length} results:\n`);
        results.forEach((r, i) => {
            console.log(`  ${i + 1}. ${r.title}`);
        });
        console.log();

        return results.map(r => ({
            ...r,
            url: this.resolveUrl(r.url)
        }));
    }

    // ==================== STEP 2: GET DETAILS ====================

    async getDetails(novelUrl) {
        console.log('═'.repeat(60));
        console.log('📖 STEP 2: Getting Novel Details');
        console.log('═'.repeat(60) + '\n');

        await this.goto(novelUrl);
        await this.screenshot('novel_details');

        const details = await this.page.evaluate((selectors) => {
            const getText = (sel) => document.querySelector(sel)?.textContent?.trim();
            const getAll = (sel) => Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim());

            return {
                title: getText(selectors.title),
                author: getText(selectors.author),
                status: getText(selectors.status),
                genres: getAll(selectors.genres),
                description: getText(selectors.description)
            };
        }, CONFIG.selectors.details);

        console.log(`  Title:  ${details.title}`);
        console.log(`  Author: ${details.author}`);
        console.log(`  Status: ${details.status}`);
        console.log(`  Genres: ${details.genres?.join(', ')}`);
        console.log(`\n  Description:\n  ${details.description?.slice(0, 300)}...`);
        console.log();

        return details;
    }

    // ==================== STEP 3: GET CHAPTER LIST ====================

    async getChapterList(novelUrl) {
        console.log('═'.repeat(60));
        console.log('📑 STEP 3: Getting Chapter List');
        console.log('═'.repeat(60) + '\n');

        if (this.page.url() !== novelUrl) {
            await this.goto(novelUrl);
        }

        // Click chapter list tab
        try {
            await this.page.click(CONFIG.selectors.details.chapterListTab);
            await this.sleep(1000);
        } catch (e) {}

        await this.screenshot('chapter_list');

        const chapters = await this.page.evaluate((selector) => {
            const links = document.querySelectorAll(selector);
            return Array.from(links).map((a, index) => ({
                index,
                title: a.textContent?.trim(),
                url: a.getAttribute('href')
            })).filter(ch => ch.url);
        }, CONFIG.selectors.details.allChapters);

        chapters.forEach(ch => {
            ch.url = this.resolveUrl(ch.url);
        });

        console.log(`  Found ${chapters.length} chapters in list\n`);

        chapters.slice(0, 5).forEach((ch, i) => {
            console.log(`  ${i + 1}. ${ch.title}`);
        });
        if (chapters.length > 5) {
            console.log(`  ... and ${chapters.length - 5} more\n`);
        }

        return chapters;
    }

    // ==================== STEP 4: GET CHAPTER CONTENT ====================

    async getChapterContent(chapterUrl) {
        await this.goto(chapterUrl);

        // Wait for content
        try {
            await this.page.waitForSelector('div#chr-content p', { timeout: 15000 });
        } catch (e) {
            console.log('  ⚠️ Timeout waiting for content');
        }
        
        await this.sleep(1000);
        await this.screenshot(`chapter_${chapterUrl.split('/').pop()}`);

        const chapter = await this.page.evaluate(() => {
            // Get title
            let title = null;
            const titleSelectors = ['h2 span.chr-text', 'h2 a.chr-title span.chr-text', 'div#chr-content h4', 'h2'];
            for (const sel of titleSelectors) {
                const el = document.querySelector(sel);
                if (el) {
                    title = el.textContent?.trim();
                    if (title) break;
                }
            }

            // Get content
            const container = document.querySelector('div#chr-content');
            let contentPreview = '';

            if (container) {
                const clone = container.cloneNode(true);
                ['div[id^="pf-"]', 'script', 'style', '.ads', 'h4', 'iframe', 'noscript'].forEach(sel => {
                    clone.querySelectorAll(sel).forEach(el => el.remove());
                });

                const paragraphs = clone.querySelectorAll('p');
                const texts = Array.from(paragraphs)
                    .map(p => p.textContent?.trim())
                    .filter(text => text && text.length > 0);

                if (texts.length > 0) {
                    contentPreview = texts.slice(0, 3).join('\n\n');
                } else {
                    contentPreview = clone.textContent?.trim()?.slice(0, 500) || '';
                }
            }

            return { title, contentPreview };
        });

        return {
            title: chapter.title,
            contentPreview: chapter.contentPreview,
            currentUrl: chapterUrl
        };
    }

    // ==================== STEP 5: CRAWL CHAPTERS ====================

    async crawlChapters(chapterList) {
        console.log('═'.repeat(60));
        console.log('📚 STEP 4 & 5: Crawling Chapters');
        console.log('═'.repeat(60) + '\n');

        const chaptersToRead = chapterList.slice(0, CONFIG.maxChaptersToTest);
        
        for (let i = 0; i < chaptersToRead.length; i++) {
            const chapterInfo = chaptersToRead[i];

            console.log('─'.repeat(60));
            console.log(`📖 Chapter ${i + 1} of ${chaptersToRead.length}`);
            console.log('─'.repeat(60) + '\n');

            try {
                const chapter = await this.getChapterContent(chapterInfo.url);

                console.log(`  Title: ${chapter.title || chapterInfo.title || 'Unknown'}`);
                console.log(`  URL:   ${chapter.currentUrl}`);
                console.log(`\n  Content Preview:`);
                console.log('  ' + '·'.repeat(50));

                const preview = chapter.contentPreview?.slice(0, 300) || 'No content found';
                console.log(`  ${preview}...`);

                console.log('  ' + '·'.repeat(50));
                console.log();

            } catch (err) {
                console.error(`  ❌ Error: ${err.message}\n`);
                await this.screenshot(`error_chapter_${i + 1}`);
            }
        }

        console.log(`✅ Read ${chaptersToRead.length} chapters.\n`);
        return chaptersToRead.length;
    }
}

// ==================== MAIN ====================

async function main() {
    const query = process.argv.slice(2).join(' ').trim();

    if (!query) {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Novel Scraper Tester                       ║
║           (with Cloudflare bypass via stealth mode)           ║
╚══════════════════════════════════════════════════════════════╝

Usage: node tester.js <search-query>

Example: node tester.js shadow slave

First, install dependencies:
  npm install puppeteer-extra puppeteer-extra-plugin-stealth
`);
        process.exit(1);
    }

    const tester = new NovelTester();

    try {
        await tester.init();

        // Step 1: Search
        const results = await tester.search(query);

        if (results.length === 0) {
            console.log('❌ No results found. Try a different search term.\n');
            process.exit(1);
        }

        const firstResult = results[0];
        console.log(`✅ Picking first result: "${firstResult.title}"\n`);

        // Step 2: Get details
        await tester.getDetails(firstResult.url);

        // Step 3: Get chapter list
        const chapterList = await tester.getChapterList(firstResult.url);

        if (!chapterList || chapterList.length === 0) {
            console.log('❌ Could not find any chapters.\n');
            process.exit(1);
        }

        // Step 4 & 5: Crawl chapters
        const chaptersRead = await tester.crawlChapters(chapterList);

        console.log('═'.repeat(60));
        console.log('✅ TEST COMPLETE');
        console.log('═'.repeat(60));
        console.log(`  Novel: ${firstResult.title}`);
        console.log(`  Chapters crawled: ${chaptersRead}`);
        console.log();

    } catch (err) {
        console.error(`\n❌ Error: ${err.message}\n`);
        process.exit(1);
    } finally {
        await tester.close();
    }
}

main();