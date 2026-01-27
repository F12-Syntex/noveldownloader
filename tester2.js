/**
 * 9Anime Tester (9anime.org.lv)
 * Usage: node tester2.js <search-query>
 * 
 * Searches anime, picks first result, shows details, gets first episode stream
 * Uses CDP network interception to capture actual video stream URLs
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const CONFIG = {
    baseUrl: "https://9anime.org.lv",
    timeout: 60000,
    rateLimit: 1500
};

class AnimeTester {
    constructor() {
        this.browser = null;
        this.page = null;
        this.lastRequestTime = 0;
        this.screenshotDir = './screenshots';
        this.screenshotCount = 0;
    }

    async init() {
        console.log('🚀 Launching browser...\n');

        const fs = await import('fs/promises');
        try {
            await fs.mkdir(this.screenshotDir, { recursive: true });
            const files = await fs.readdir(this.screenshotDir);
            for (const file of files) {
                await fs.unlink(`${this.screenshotDir}/${file}`);
            }
        } catch (e) {}

        this.browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1920,1080',
                '--autoplay-policy=no-user-gesture-required'
            ]
        });

        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1920, height: 1080 });
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('✅ Browser ready.\n');
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async rateLimit() {
        const elapsed = Date.now() - this.lastRequestTime;
        if (elapsed < CONFIG.rateLimit) {
            await this.sleep(CONFIG.rateLimit - elapsed);
        }
        this.lastRequestTime = Date.now();
    }

    async screenshot(name, page = null) {
        this.screenshotCount++;
        const filename = `${this.screenshotDir}/${String(this.screenshotCount).padStart(2, '0')}_${name}.png`;
        const targetPage = page || this.page;
        await targetPage.screenshot({ path: filename, fullPage: false });
        console.log(`  📸 Screenshot: ${filename}\n`);
    }

    async goto(url, page = null) {
        await this.rateLimit();
        console.log(`📡 Navigating to: ${url}\n`);
        const targetPage = page || this.page;
        await targetPage.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.timeout
        });
        await this.sleep(1000);
    }

    resolveUrl(url) {
        if (!url) return null;
        if (url.startsWith('http')) return url;
        if (url.startsWith('//')) return `https:${url}`;
        return new URL(url, CONFIG.baseUrl).href;
    }

    // ==================== STEP 1: SEARCH ====================

    async search(query) {
        console.log('═'.repeat(60));
        console.log(`🔍 STEP 1: Searching for "${query}"`);
        console.log('═'.repeat(60) + '\n');

        const searchUrl = `${CONFIG.baseUrl}/?s=${encodeURIComponent(query)}`;
        await this.goto(searchUrl);
        await this.screenshot('search_results');

        const results = await this.page.evaluate(() => {
            const items = document.querySelectorAll('article.bs div.bsx a.tip, div.listupd article.bs a.tip');
            return Array.from(items).map(item => {
                const title = item.getAttribute('title') || item.querySelector('.tt')?.textContent?.trim();
                const url = item.getAttribute('href');
                const statusEl = item.querySelector('.status, .epx');
                const status = statusEl?.textContent?.trim();
                return { title, url, status };
            }).filter(r => r.title && r.url);
        });

        results.forEach(r => r.url = this.resolveUrl(r.url));

        console.log(`📺 Found ${results.length} results:\n`);
        results.forEach((r, i) => console.log(`  ${i + 1}. ${r.title} ${r.status ? `[${r.status}]` : ''}`));
        console.log();

        return results;
    }

    // ==================== STEP 2: GET DETAILS ====================

    async getDetails(animeUrl) {
        console.log('═'.repeat(60));
        console.log('📖 STEP 2: Getting Anime Details');
        console.log('═'.repeat(60) + '\n');

        await this.goto(animeUrl);
        await this.screenshot('anime_details');

        const details = await this.page.evaluate(() => {
            const getText = (sel) => document.querySelector(sel)?.textContent?.trim();
            const genreEls = document.querySelectorAll('div.genxed a, div.info-content a[href*="/genres/"]');
            const genres = Array.from(genreEls).map(el => el.textContent?.trim()).filter(Boolean);

            const info = {};
            document.querySelectorAll('div.spe span, div.info-content span').forEach(span => {
                const text = span.textContent?.trim();
                if (text?.includes(':')) {
                    const [key, value] = text.split(':').map(s => s.trim());
                    if (key && value) info[key.toLowerCase()] = value;
                } else if (text && !info.status) {
                    info.status = text;
                }
            });

            return {
                title: getText('h1.entry-title'),
                description: document.querySelector('div.entry-content p, div.desc')?.textContent?.trim(),
                genres,
                ...info
            };
        });

        console.log(`  Title:       ${details.title}`);
        console.log(`  Status:      ${details.status || 'Unknown'}`);
        console.log(`  Genres:      ${details.genres?.join(', ') || 'Unknown'}`);
        console.log(`  Description: ${details.description?.slice(0, 150)}...`);
        console.log();

        return details;
    }

    // ==================== STEP 3: GET EPISODES ====================

    async getEpisodes() {
        console.log('═'.repeat(60));
        console.log('📋 STEP 3: Getting Episodes');
        console.log('═'.repeat(60) + '\n');

        const episodes = await this.page.evaluate(() => {
            const eps = [];
            document.querySelectorAll('div.eplister ul li a').forEach((link, i, arr) => {
                const numEl = link.querySelector('.epl-num');
                const titleEl = link.querySelector('.epl-title');
                eps.push({
                    number: numEl?.textContent?.trim() || (arr.length - i).toString(),
                    title: titleEl?.textContent?.trim() || `Episode ${arr.length - i}`,
                    url: link.getAttribute('href')
                });
            });
            
            if (eps.length === 0) {
                const firstEp = document.querySelector('div.lastend a[href*="episode"]');
                if (firstEp) {
                    eps.push({ number: '1', title: 'Episode 1', url: firstEp.getAttribute('href') });
                }
            }
            return eps;
        });

        episodes.forEach(ep => {
            ep.url = this.resolveUrl(ep.url);
            ep.number = parseInt(ep.number) || 1;
        });
        episodes.sort((a, b) => a.number - b.number);

        console.log(`  Found ${episodes.length} episodes:\n`);
        episodes.slice(0, 5).forEach(ep => console.log(`  Ep ${ep.number}: ${ep.title}`));
        if (episodes.length > 5) console.log(`  ... and ${episodes.length - 5} more`);
        console.log();

        return episodes;
    }

    // ==================== STEP 4: GET STREAM ====================

    async getStream(episodeUrl) {
        console.log('═'.repeat(60));
        console.log('🎬 STEP 4: Getting Stream Info');
        console.log('═'.repeat(60) + '\n');

        await this.goto(episodeUrl);
        await this.screenshot('episode_page');

        // Get servers
        const servers = await this.page.evaluate(() => {
            const list = [];
            document.querySelectorAll('select.mirror option').forEach(opt => {
                if (opt.value) list.push({ name: opt.textContent?.trim(), value: opt.value });
            });
            return list;
        });

        console.log(`  Available Servers: ${servers.length}`);
        servers.forEach((s, i) => console.log(`    ${i + 1}. ${s.name}`));
        console.log();

        // Get first iframe
        const iframeSrc = await this.page.evaluate(() => {
            return document.querySelector('iframe[src*="player"], iframe[src*="embed"], iframe[src*="newplayer"]')?.src;
        });

        console.log(`  Embed URL: ${iframeSrc || 'Not found'}\n`);

        const streamUrls = [];

        if (iframeSrc) {
            console.log('  🎯 Setting up video capture on new page...\n');

            // Create dedicated page for video capture with CDP
            const videoPage = await this.browser.newPage();
            const client = await videoPage.target().createCDPSession();
            
            // ANTI-DEBUGGING BYPASS
            await client.send('Runtime.enable');
            await client.send('Debugger.enable');
            
            // Disable debugger detection
            await client.send('Debugger.setBreakpointsActive', { active: false });
            
            // Override debugger detection methods
            await videoPage.evaluateOnNewDocument(() => {
                // Prevent debugger detection via timing
                const originalDateNow = Date.now;
                let offset = 0;
                Date.now = function() {
                    return originalDateNow.call(Date) - offset;
                };

                // Block debugger statements
                const handler = {
                    get(target, prop) {
                        if (prop === 'constructor') {
                            return function() { return function() {}; };
                        }
                        return target[prop];
                    }
                };

                // Prevent detection via console
                const consoleProxy = new Proxy(console, handler);
                
                // Override devtools detection
                Object.defineProperty(window, 'devtools', { get: () => false });
                Object.defineProperty(window, '__DEVTOOLS__', { get: () => false });
                
                // Prevent outerWidth/outerHeight detection
                const origOuterWidth = window.outerWidth;
                const origOuterHeight = window.outerHeight;
                Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
                Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight });
                
                // Block debugger via Function constructor
                const origFunction = Function;
                Function = function(...args) {
                    const code = args[args.length - 1];
                    if (typeof code === 'string' && code.includes('debugger')) {
                        return function() {};
                    }
                    return origFunction.apply(this, args);
                };
                Function.prototype = origFunction.prototype;
                
                // Intercept and block debugger in eval
                const origEval = window.eval;
                window.eval = function(code) {
                    if (typeof code === 'string' && code.includes('debugger')) {
                        return undefined;
                    }
                    return origEval.call(window, code);
                };

                // Prevent setInterval debugger traps
                const origSetInterval = window.setInterval;
                window.setInterval = function(fn, delay, ...args) {
                    const fnStr = fn.toString();
                    if (fnStr.includes('debugger') || fnStr.includes('devtools')) {
                        return 0;
                    }
                    return origSetInterval.call(window, fn, delay, ...args);
                };

                // Prevent setTimeout debugger traps
                const origSetTimeout = window.setTimeout;
                window.setTimeout = function(fn, delay, ...args) {
                    if (typeof fn === 'function') {
                        const fnStr = fn.toString();
                        if (fnStr.includes('debugger') || fnStr.includes('devtools')) {
                            return 0;
                        }
                    }
                    return origSetTimeout.call(window, fn, delay, ...args);
                };

                // Block requestAnimationFrame debugger detection
                const origRAF = window.requestAnimationFrame;
                window.requestAnimationFrame = function(fn) {
                    const fnStr = fn.toString();
                    if (fnStr.includes('debugger') || fnStr.includes('devtools')) {
                        return 0;
                    }
                    return origRAF.call(window, fn);
                };
            });
            
            await client.send('Network.enable');
            
            const capturedUrls = new Map();
            
            // Listen for ALL network responses
            client.on('Network.responseReceived', async (event) => {
                const url = event.response.url;
                const type = event.type;
                const mime = event.response.mimeType || '';
                
                // Capture video-related URLs
                const isVideo = url.includes('.m3u8') || url.includes('.mp4') || 
                               url.includes('.ts') || url.includes('master') ||
                               url.includes('playlist') || url.includes('index.m3u8') ||
                               mime.includes('mpegurl') || mime.includes('video') ||
                               type === 'Media';
                
                const isSource = url.includes('getSources') || url.includes('source') ||
                                url.includes('ajax') || url.includes('encrypt');
                
                if (isVideo || isSource) {
                    if (!capturedUrls.has(url)) {
                        capturedUrls.set(url, { type: type || 'unknown', mime });
                        console.log(`  📡 [${type || mime || 'req'}] ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
                        
                        // For API responses, try to get the body
                        if (isSource && !isVideo) {
                            try {
                                const body = await client.send('Network.getResponseBody', { requestId: event.requestId });
                                const text = body.body || '';
                                
                                // Look for URLs in JSON response
                                const m3u8Matches = text.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g);
                                const mp4Matches = text.match(/https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/g);
                                
                                if (m3u8Matches) {
                                    m3u8Matches.forEach(u => {
                                        const clean = u.replace(/\\/g, '');
                                        streamUrls.push({ type: 'api-hls', url: clean });
                                        console.log(`  ✓ Found HLS: ${clean.substring(0, 80)}...`);
                                    });
                                }
                                if (mp4Matches) {
                                    mp4Matches.forEach(u => {
                                        const clean = u.replace(/\\/g, '');
                                        streamUrls.push({ type: 'api-mp4', url: clean });
                                        console.log(`  ✓ Found MP4: ${clean.substring(0, 80)}...`);
                                    });
                                }
                            } catch (e) {}
                        }
                        
                        if (url.includes('.m3u8')) {
                            streamUrls.push({ type: 'hls', url });
                        } else if (url.includes('.mp4') && !url.includes('thumb')) {
                            streamUrls.push({ type: 'mp4', url });
                        }
                    }
                }
            });

            await videoPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Load the embed
            console.log(`  Loading embed page...\n`);
            try {
                await videoPage.goto(iframeSrc, { waitUntil: 'networkidle2', timeout: 30000 });
            } catch (e) {
                console.log(`  Embed load issue: ${e.message}\n`);
            }
            await this.sleep(2000);
            await this.screenshot('embed', videoPage);

            // Check for nested iframe
            const nestedSrc = await videoPage.evaluate(() => {
                return document.querySelector('iframe')?.src;
            });

            if (nestedSrc && nestedSrc !== iframeSrc) {
                const nestedUrl = this.resolveUrl(nestedSrc);
                console.log(`  Found player iframe: ${nestedUrl}\n`);
                streamUrls.push({ type: 'player-url', url: nestedUrl });

                console.log('  Loading player (waiting for video streams)...\n');
                try {
                    await videoPage.goto(nestedUrl, { waitUntil: 'networkidle0', timeout: 45000 });
                } catch (e) {
                    console.log(`  Player load: ${e.message}\n`);
                }
                
                // Wait for video to potentially start
                await this.sleep(3000);
                
                // Try clicking play
                try {
                    await videoPage.evaluate(() => {
                        const video = document.querySelector('video');
                        if (video) video.play();
                        document.querySelector('.play, [class*="play"], button')?.click();
                    });
                    console.log('  Triggered play...\n');
                } catch (e) {}

                // Wait more for streams
                await this.sleep(5000);
                await this.screenshot('player', videoPage);

                // Check video element
                const videoInfo = await videoPage.evaluate(() => {
                    const v = document.querySelector('video');
                    return v ? { src: v.src, currentSrc: v.currentSrc, ready: v.readyState } : null;
                });
                
                if (videoInfo) {
                    console.log(`  Video element: readyState=${videoInfo.ready}`);
                    if (videoInfo.src && !videoInfo.src.startsWith('blob:')) {
                        streamUrls.push({ type: 'video-src', url: videoInfo.src });
                    }
                    if (videoInfo.currentSrc && !videoInfo.currentSrc.startsWith('blob:')) {
                        streamUrls.push({ type: 'video-currentSrc', url: videoInfo.currentSrc });
                    }
                    if (videoInfo.src?.startsWith('blob:') || videoInfo.currentSrc?.startsWith('blob:')) {
                        console.log('  (Video uses blob URL - HLS stream via MSE)');
                    }
                }
            }

            await videoPage.close();
        }

        // Dedupe
        const unique = [...new Map(streamUrls.map(s => [s.url, s])).values()];

        console.log(`\n  Total Stream URLs: ${unique.length}\n`);
        unique.forEach((s, i) => console.log(`    ${i + 1}. [${s.type}] ${s.url}`));
        console.log();

        return { episodeUrl, servers, iframeSrc, streamUrls: unique };
    }
}

// ==================== MAIN ====================

async function main() {
    const query = process.argv.slice(2).join(' ').trim();

    if (!query) {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    9Anime Stream Extractor                    ║
╚══════════════════════════════════════════════════════════════╝

Usage: node tester2.js <search-query>

Example: node tester2.js fire force

This will:
  1. Search for anime
  2. Pick first result  
  3. Get first episode
  4. Extract video stream URL via network capture
`);
        process.exit(1);
    }

    const tester = new AnimeTester();

    try {
        await tester.init();
        
        const results = await tester.search(query);
        if (!results.length) { console.log('❌ No results'); process.exit(1); }

        const first = results[0];
        console.log(`✅ Selected: "${first.title}"\n`);

        const details = await tester.getDetails(first.url);
        const episodes = await tester.getEpisodes();
        
        if (!episodes.length) { console.log('❌ No episodes'); process.exit(1); }

        console.log(`✅ Getting Episode ${episodes[0].number}\n`);
        const stream = await tester.getStream(episodes[0].url);

        // Summary
        console.log('═'.repeat(60));
        console.log('✅ SUMMARY');
        console.log('═'.repeat(60));
        console.log(`  Anime:    ${details.title}`);
        console.log(`  Episode:  ${episodes[0].number}`);
        console.log(`  Streams:  ${stream.streamUrls.length} found`);

        const hls = stream.streamUrls.find(s => s.type.includes('hls') || s.url.includes('.m3u8'));
        const mp4 = stream.streamUrls.find(s => s.type.includes('mp4') || s.url.includes('.mp4'));
        const player = stream.streamUrls.find(s => s.type === 'player-url');

        if (hls) {
            console.log(`\n  HLS Stream:\n    ${hls.url}`);
            console.log(`\n  Download:\n    ffmpeg -i "${hls.url}" -c copy output.mp4`);
        } else if (mp4) {
            console.log(`\n  MP4 Stream:\n    ${mp4.url}`);
            console.log(`\n  Download:\n    wget "${mp4.url}" -O output.mp4`);
        } else if (player) {
            console.log(`\n  Player URL:\n    ${player.url}`);
            console.log(`\n  The video uses encrypted HLS. Try:`);
            console.log(`    1. Open player URL in browser`);
            console.log(`    2. Use browser DevTools Network tab to find .m3u8`);
            console.log(`    3. Or use a video download extension`);
        }
        console.log();

    } catch (err) {
        console.error(`\n❌ Error: ${err.message}\n`);
        process.exit(1);
    } finally {
        await tester.close();
    }
}

main();