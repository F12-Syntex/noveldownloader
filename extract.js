#!/usr/bin/env node

/**
 * HTML Structure Extractor (Puppeteer version)
 *
 * A standalone tool to analyze website HTML structure for creating source configs.
 * Uses Puppeteer headless browser to bypass anti-bot protections.
 *
 * Usage: node extract.js [url1] [url2] ...
 *        node extract.js  (interactive mode - paste URLs)
 *
 * Output: html-output/<domain>/page.html
 */

import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    // Tags to completely remove
    removeTags: [
        'script', 'style', 'noscript', 'iframe', 'svg', 'path',
        'meta', 'link', 'head', 'br', 'hr', 'input', 'button', 'form'
    ],
    // Attributes to keep
    keepAttrs: ['id', 'class', 'href', 'src', 'data-id', 'data-url', 'data-page', 'title', 'alt'],
    // Max text length before truncating
    maxTextLength: 80,
    // Max children to show before collapsing
    maxChildren: 15,
    // Tags that usually contain useful data
    dataTags: ['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'li', 'td', 'th', 'img', 'div'],
    // Puppeteer settings
    browser: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
        ]
    },
    // Page settings
    page: {
        timeout: 30000,
        waitUntil: 'networkidle2',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
};

// ============================================================================
// Puppeteer Browser Management
// ============================================================================

let browser = null;

async function getBrowser() {
    if (!browser) {
        console.log('  Launching browser...');
        browser = await puppeteer.launch(CONFIG.browser);
    }
    return browser;
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}

async function fetchPage(url) {
    console.log(`  Fetching: ${url}`);

    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        // Set user agent
        await page.setUserAgent(CONFIG.page.userAgent);

        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Block unnecessary resources to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Navigate to page
        await page.goto(url, {
            waitUntil: CONFIG.page.waitUntil,
            timeout: CONFIG.page.timeout
        });

        // Wait a bit for dynamic content
        await new Promise(r => setTimeout(r, 1500));

        // Get the full HTML
        const html = await page.content();

        return html;
    } finally {
        await page.close();
    }
}

// ============================================================================
// HTML Processing
// ============================================================================

function processHtml(html, url) {
    const $ = cheerio.load(html);

    // Remove unwanted tags
    CONFIG.removeTags.forEach(tag => $(tag).remove());

    // Remove comments
    $('*').contents().filter(function() {
        return this.type === 'comment';
    }).remove();

    // Remove hidden elements
    $('[style*="display: none"], [style*="display:none"], .hidden, [hidden]').remove();

    // Process the body
    const body = $('body');

    // Build the structure analysis
    const structure = analyzeStructure($, body, '', 0);
    const selectors = findDataSelectors($, body);

    return { structure, selectors, $ };
}

/**
 * Recursively analyze DOM structure
 */
function analyzeStructure($, element, parentPath, depth) {
    const results = [];

    element.children().each((i, child) => {
        const $child = $(child);
        const tagName = child.tagName?.toLowerCase();

        if (!tagName || CONFIG.removeTags.includes(tagName)) return;

        const selector = buildSelector($child, tagName);
        const currentPath = parentPath ? `${parentPath} > ${selector}` : selector;

        const directText = getDirectText($child).trim();
        const truncatedText = directText.length > CONFIG.maxTextLength
            ? directText.substring(0, CONFIG.maxTextLength) + '...'
            : directText;

        const childCount = $child.children().length;

        const nodeInfo = {
            tag: tagName,
            selector: selector,
            path: currentPath,
            text: truncatedText || null,
            childCount,
            depth
        };

        if (CONFIG.dataTags.includes(tagName) && (directText || tagName === 'a' || tagName === 'img')) {
            nodeInfo.isData = true;

            if (tagName === 'a') {
                const href = $child.attr('href');
                if (href) nodeInfo.href = href.substring(0, 100);
            }

            if (tagName === 'img') {
                const src = $child.attr('src');
                if (src) nodeInfo.src = src.substring(0, 100);
            }
        }

        results.push(nodeInfo);

        if (childCount > 0 && depth < 10) {
            const childResults = analyzeStructure($, $child, currentPath, depth + 1);

            if (childResults.length > CONFIG.maxChildren) {
                const collapsed = collapseRepeating(childResults);
                results.push(...collapsed);
            } else {
                results.push(...childResults);
            }
        }
    });

    return results;
}

function buildSelector($el, tagName) {
    const id = $el.attr('id');
    const classes = $el.attr('class');

    let selector = tagName;

    if (id) {
        const cleanId = id.replace(/\d+/g, '*');
        selector += `#${cleanId}`;
    } else if (classes) {
        const classArr = classes.split(/\s+/)
            .filter(c => c && !c.match(/^(js-|is-|has-|active|hidden|show|visible|col-|row|container)/))
            .slice(0, 2);
        if (classArr.length) {
            selector += '.' + classArr.join('.');
        }
    }

    return selector;
}

function getDirectText($el) {
    return $el.contents()
        .filter(function() {
            return this.type === 'text';
        })
        .text()
        .replace(/\s+/g, ' ')
        .trim();
}

function collapseRepeating(nodes) {
    const groups = {};

    nodes.forEach(node => {
        const key = `${node.tag}:${node.selector}`;
        if (!groups[key]) {
            groups[key] = { ...node, count: 1 };
        } else {
            groups[key].count++;
        }
    });

    return Object.values(groups).map(g => ({
        ...g,
        text: g.count > 1 ? `[${g.count} items]` : g.text
    }));
}

function findDataSelectors($, body) {
    const selectors = {
        lists: [],
        links: [],
        headings: [],
        images: [],
        textBlocks: []
    };

    // Find list-like structures
    $('ul, ol, .list, [class*="list"]').each((i, el) => {
        const $el = $(el);
        const itemCount = $el.children('li, .item, [class*="item"], a').length;
        if (itemCount >= 3) {
            selectors.lists.push({
                container: getFullSelector($el),
                itemCount,
                sample: $el.children().first().text().trim().substring(0, 50)
            });
        }
    });

    // Find grouped links
    const linkGroups = {};
    $('a[href]').each((i, el) => {
        const $el = $(el);
        const $parent = $el.parent();
        const parentSelector = getFullSelector($parent);

        if (!linkGroups[parentSelector]) {
            linkGroups[parentSelector] = [];
        }
        linkGroups[parentSelector].push({
            text: $el.text().trim().substring(0, 50),
            href: $el.attr('href')
        });
    });

    Object.entries(linkGroups).forEach(([selector, links]) => {
        if (links.length >= 3) {
            selectors.links.push({
                container: selector,
                count: links.length,
                samples: links.slice(0, 3)
            });
        }
    });

    // Find headings
    $('h1, h2, h3, h4').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        if (text) {
            selectors.headings.push({
                tag: el.tagName.toLowerCase(),
                selector: getFullSelector($el),
                text: text.substring(0, 80)
            });
        }
    });

    // Find main images
    $('img[src]').each((i, el) => {
        const $el = $(el);
        const src = $el.attr('src') || '';
        if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar') && !src.includes('data:')) {
            selectors.images.push({
                selector: getFullSelector($el),
                src: src.substring(0, 100),
                alt: $el.attr('alt')?.substring(0, 50)
            });
        }
    });

    // Find text blocks (paragraphs with content)
    $('p, .content, .text, [class*="content"], [class*="chapter"]').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        if (text.length > 100) {
            selectors.textBlocks.push({
                selector: getFullSelector($el),
                preview: text.substring(0, 100) + '...'
            });
        }
    });

    return selectors;
}

function getFullSelector($el) {
    const parts = [];
    let current = $el;

    while (current.length && current[0].tagName) {
        const tag = current[0].tagName.toLowerCase();
        if (tag === 'html' || tag === 'body') break;

        const id = current.attr('id');
        const classes = current.attr('class');

        let part = tag;
        if (id) {
            part += `#${id.replace(/\d+/g, '*')}`;
        } else if (classes) {
            const mainClass = classes.split(/\s+/)
                .filter(c => c && c.length < 30 && !c.match(/^(js-|is-|has-|col-|row)/))
                .slice(0, 1)[0];
            if (mainClass) part += `.${mainClass}`;
        }

        parts.unshift(part);
        current = current.parent();

        if (id) break;
    }

    return parts.join(' > ');
}

// ============================================================================
// Output Generation
// ============================================================================

function generateOutput(url, structure, selectors) {
    const lines = [];

    lines.push('<!DOCTYPE html>');
    lines.push('<html>');
    lines.push('<head>');
    lines.push('  <meta charset="UTF-8">');
    lines.push(`  <title>Structure: ${url}</title>`);
    lines.push('  <style>');
    lines.push('    body { font-family: monospace; font-size: 12px; background: #1e1e1e; color: #d4d4d4; padding: 20px; }');
    lines.push('    .section { margin: 20px 0; padding: 15px; background: #252526; border-radius: 4px; }');
    lines.push('    .section-title { color: #569cd6; font-size: 14px; margin-bottom: 10px; font-weight: bold; }');
    lines.push('    .path { color: #9cdcfe; cursor: pointer; }');
    lines.push('    .path:hover { background: #264f78; }');
    lines.push('    .tag { color: #4ec9b0; }');
    lines.push('    .text { color: #ce9178; }');
    lines.push('    .data { background: #264f78; padding: 2px 5px; border-radius: 2px; }');
    lines.push('    .count { color: #b5cea8; }');
    lines.push('    .href { color: #6a9955; font-size: 11px; }');
    lines.push('    .indent { margin-left: 20px; }');
    lines.push('    .selector-box { background: #1e1e1e; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 3px solid #569cd6; }');
    lines.push('    pre { margin: 0; white-space: pre-wrap; word-break: break-all; }');
    lines.push('    .copy-hint { color: #6a9955; font-size: 10px; }');
    lines.push('    h3 { color: #c586c0; margin: 15px 0 10px 0; }');
    lines.push('  </style>');
    lines.push('  <script>');
    lines.push('    function copyText(el) {');
    lines.push('      const text = el.innerText;');
    lines.push('      navigator.clipboard.writeText(text);');
    lines.push('      el.style.background = "#4ec9b0";');
    lines.push('      setTimeout(() => el.style.background = "", 200);');
    lines.push('    }');
    lines.push('  </script>');
    lines.push('</head>');
    lines.push('<body>');

    lines.push(`<h2 style="color:#dcdcaa">Source: <span style="color:#ce9178">${escapeHtml(url)}</span></h2>`);
    lines.push(`<p class="copy-hint">Click any selector to copy it</p>`);

    // Likely data selectors section
    lines.push('<div class="section">');
    lines.push('  <div class="section-title">LIKELY DATA SELECTORS</div>');

    // Link groups
    if (selectors.links.length > 0) {
        lines.push('  <h3>Link Groups (chapters, navigation):</h3>');
        selectors.links.slice(0, 10).forEach(group => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="path" onclick="copyText(this)">${escapeHtml(group.container)}</span> <span class="count">[${group.count} links]</span></div>`);
            group.samples.forEach(s => {
                lines.push(`    <div class="indent">→ <span class="text">"${escapeHtml(s.text)}"</span> <span class="href">${escapeHtml(s.href || '')}</span></div>`);
            });
            lines.push('  </div>');
        });
    }

    // Headings
    if (selectors.headings.length > 0) {
        lines.push('  <h3>Headings (titles):</h3>');
        selectors.headings.slice(0, 8).forEach(h => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="tag">&lt;${h.tag}&gt;</span> <span class="path" onclick="copyText(this)">${escapeHtml(h.selector)}</span></div>`);
            lines.push(`    <div class="indent text">"${escapeHtml(h.text)}"</div>`);
            lines.push('  </div>');
        });
    }

    // Text blocks
    if (selectors.textBlocks.length > 0) {
        lines.push('  <h3>Text Blocks (content):</h3>');
        selectors.textBlocks.slice(0, 5).forEach(block => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="path" onclick="copyText(this)">${escapeHtml(block.selector)}</span></div>`);
            lines.push(`    <div class="indent text">"${escapeHtml(block.preview)}"</div>`);
            lines.push('  </div>');
        });
    }

    // Lists
    if (selectors.lists.length > 0) {
        lines.push('  <h3>List Structures:</h3>');
        selectors.lists.slice(0, 5).forEach(list => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="path" onclick="copyText(this)">${escapeHtml(list.container)}</span> <span class="count">[${list.itemCount} items]</span></div>`);
            lines.push('  </div>');
        });
    }

    // Images
    if (selectors.images.length > 0) {
        lines.push('  <h3>Images (covers):</h3>');
        selectors.images.slice(0, 5).forEach(img => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="path" onclick="copyText(this)">${escapeHtml(img.selector)}</span></div>`);
            lines.push(`    <div class="indent href">${escapeHtml(img.src)}</div>`);
            lines.push('  </div>');
        });
    }

    lines.push('</div>');

    // Quick copy selectors
    lines.push('<div class="section">');
    lines.push('  <div class="section-title">ALL DATA SELECTORS (click to copy)</div>');
    lines.push('  <div style="display:flex;flex-wrap:wrap;gap:5px;">');

    const uniqueSelectors = [...new Set(
        structure
            .filter(n => n.isData)
            .map(n => n.selector)
    )];
    uniqueSelectors.slice(0, 50).forEach(sel => {
        lines.push(`    <span class="path" onclick="copyText(this)" style="padding:3px 8px;background:#333;border-radius:3px;">${escapeHtml(sel)}</span>`);
    });

    lines.push('  </div>');
    lines.push('</div>');

    // Full structure tree
    lines.push('<div class="section">');
    lines.push('  <div class="section-title">STRUCTURE TREE</div>');
    lines.push('  <pre>');

    const dataNodes = structure.filter(n => n.isData || n.childCount > 2);
    dataNodes.slice(0, 200).forEach(node => {
        const indent = '  '.repeat(Math.min(node.depth, 6));
        const dataMarker = node.isData ? '<span class="data">★</span> ' : '';
        const countInfo = node.count > 1 ? ` <span class="count">×${node.count}</span>` : '';
        const textInfo = node.text ? ` <span class="text">"${escapeHtml(node.text)}"</span>` : '';
        const hrefInfo = node.href ? ` <span class="href">[${escapeHtml(node.href)}]</span>` : '';

        lines.push(`${indent}${dataMarker}<span class="tag">${node.tag}</span> <span class="path" onclick="copyText(this)">${escapeHtml(node.selector)}</span>${countInfo}${textInfo}${hrefInfo}`);
    });

    lines.push('  </pre>');
    lines.push('</div>');

    lines.push('</body>');
    lines.push('</html>');

    return lines.join('\n');
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ============================================================================
// Interactive Input
// ============================================================================

async function promptForUrls() {
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log(`
HTML Structure Extractor (Puppeteer)
====================================
Paste your URLs below (one per line or space-separated).
Press Enter twice when done.
`);

    return new Promise((resolve) => {
        const urls = [];
        let emptyLineCount = 0;

        rl.on('line', (line) => {
            const trimmed = line.trim();
            if (trimmed === '') {
                emptyLineCount++;
                if (emptyLineCount >= 1 && urls.length > 0) {
                    rl.close();
                }
            } else {
                emptyLineCount = 0;
                const urlMatches = trimmed.match(/https?:\/\/[^\s"'<>]+/g);
                if (urlMatches) {
                    urls.push(...urlMatches);
                }
            }
        });

        rl.on('close', () => {
            resolve(urls);
        });
    });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    let args = process.argv.slice(2);

    if (args.length === 0) {
        const urls = await promptForUrls();
        if (urls.length === 0) {
            console.log('No URLs provided. Exiting.');
            process.exit(1);
        }
        args = urls;
    }

    // Validate URLs
    const urls = [];
    for (const arg of args) {
        try {
            const url = new URL(arg);
            urls.push(url.href);
        } catch {
            console.error(`Invalid URL: ${arg}`);
        }
    }

    if (urls.length === 0) {
        console.log('No valid URLs found. Exiting.');
        process.exit(1);
    }

    const domain = new URL(urls[0]).hostname;
    const outputDir = path.join('html-output', domain);

    console.log(`\nHTML Structure Extractor`);
    console.log(`========================`);
    console.log(`URLs to process: ${urls.length}`);
    console.log(`Output directory: ${outputDir}\n`);

    await fs.mkdir(outputDir, { recursive: true });

    try {
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];

            try {
                const html = await fetchPage(url);
                console.log(`  Analyzing structure...`);

                const { structure, selectors } = processHtml(html, url);
                const output = generateOutput(url, structure, selectors);

                let filename;
                try {
                    const urlObj = new URL(url);
                    const pathPart = urlObj.pathname.replace(/\//g, '_').replace(/^_/, '') || 'index';
                    const queryPart = urlObj.search ? '_' + urlObj.search.replace(/[?&=]/g, '_').substring(0, 30) : '';
                    filename = `${pathPart}${queryPart}.html`.replace(/[<>:"|?*]/g, '_').substring(0, 100);
                } catch {
                    filename = `page-${i + 1}.html`;
                }

                const outputPath = path.join(outputDir, filename);
                await fs.writeFile(outputPath, output, 'utf-8');
                console.log(`  ✓ Saved: ${outputPath}\n`);

            } catch (error) {
                console.error(`  ✗ Error: ${error.message}\n`);
            }
        }
    } finally {
        await closeBrowser();
    }

    console.log(`Done! Open the HTML files in ${outputDir}/ to view results.`);
}

main().catch(async (error) => {
    console.error('Fatal error:', error);
    await closeBrowser();
    process.exit(1);
});
