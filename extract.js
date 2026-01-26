#!/usr/bin/env node

/**
 * HTML Structure Extractor
 *
 * A standalone tool to analyze website HTML structure for creating source configs.
 * Outputs a condensed, simplified schema showing CSS selector paths.
 *
 * Usage: node extract.js <url1> [url2] [url3] ...
 * Output: html-output/<domain>/page-<index>.html
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    // Tags to completely remove (scripts, styles, etc.)
    removeTags: [
        'script', 'style', 'noscript', 'iframe', 'svg', 'path',
        'meta', 'link', 'head', 'comment', 'br', 'hr'
    ],
    // Attributes to keep (others are stripped)
    keepAttrs: ['id', 'class', 'href', 'src', 'data-id', 'data-url', 'data-page', 'title', 'alt'],
    // Max text length before truncating
    maxTextLength: 80,
    // Max children to show before collapsing
    maxChildren: 15,
    // Tags that usually contain useful data
    dataTags: ['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'li', 'td', 'th', 'img'],
    // User agent for requests
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// ============================================================================
// HTML Fetching
// ============================================================================

async function fetchPage(url) {
    console.log(`  Fetching: ${url}`);

    const response = await fetch(url, {
        headers: {
            'User-Agent': CONFIG.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 30000
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
}

// ============================================================================
// HTML Processing
// ============================================================================

/**
 * Clean and simplify HTML structure
 */
function processHtml(html, url) {
    const $ = cheerio.load(html);

    // Remove unwanted tags
    CONFIG.removeTags.forEach(tag => $(tag).remove());

    // Remove comments
    $('*').contents().filter(function() {
        return this.type === 'comment';
    }).remove();

    // Process the body
    const body = $('body');

    // Build the structure analysis
    const structure = analyzeStructure($, body, '', 0);
    const selectors = findDataSelectors($, body);

    return { structure, selectors, $ };
}

/**
 * Recursively analyze DOM structure and build condensed representation
 */
function analyzeStructure($, element, parentPath, depth) {
    const results = [];

    element.children().each((i, child) => {
        const $child = $(child);
        const tagName = child.tagName?.toLowerCase();

        if (!tagName || CONFIG.removeTags.includes(tagName)) return;

        // Build selector for this element
        const selector = buildSelector($child, tagName);
        const currentPath = parentPath ? `${parentPath} > ${selector}` : selector;

        // Get text content (direct text only, not from children)
        const directText = getDirectText($child).trim();
        const truncatedText = directText.length > CONFIG.maxTextLength
            ? directText.substring(0, CONFIG.maxTextLength) + '...'
            : directText;

        // Count children
        const childCount = $child.children().length;

        // Build node info
        const nodeInfo = {
            tag: tagName,
            selector: selector,
            path: currentPath,
            text: truncatedText || null,
            childCount,
            depth
        };

        // Determine if this is a potential data node
        if (CONFIG.dataTags.includes(tagName) && (directText || tagName === 'a' || tagName === 'img')) {
            nodeInfo.isData = true;

            // Add href for links
            if (tagName === 'a') {
                const href = $child.attr('href');
                if (href) nodeInfo.href = href.substring(0, 100);
            }

            // Add src for images
            if (tagName === 'img') {
                const src = $child.attr('src');
                if (src) nodeInfo.src = src.substring(0, 100);
            }
        }

        results.push(nodeInfo);

        // Recurse into children (with depth limit)
        if (childCount > 0 && depth < 10) {
            const childResults = analyzeStructure($, $child, currentPath, depth + 1);

            // Collapse if too many children of same type
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

/**
 * Build a CSS selector for an element
 */
function buildSelector($el, tagName) {
    const id = $el.attr('id');
    const classes = $el.attr('class');

    let selector = tagName;

    if (id) {
        // Clean ID (remove dynamic parts)
        const cleanId = id.replace(/\d+/g, '*');
        selector += `#${cleanId}`;
    } else if (classes) {
        // Get first 2 meaningful classes
        const classArr = classes.split(/\s+/)
            .filter(c => c && !c.match(/^(js-|is-|has-|active|hidden|show|visible)/))
            .slice(0, 2);
        if (classArr.length) {
            selector += '.' + classArr.join('.');
        }
    }

    return selector;
}

/**
 * Get direct text content (not from children)
 */
function getDirectText($el) {
    return $el.contents()
        .filter(function() {
            return this.type === 'text';
        })
        .text()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Collapse repeating similar elements
 */
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

/**
 * Find likely data selectors (lists, repeated patterns)
 */
function findDataSelectors($, body) {
    const selectors = {
        lists: [],
        links: [],
        headings: [],
        images: [],
        forms: []
    };

    // Find list-like structures
    $('ul, ol, .list, [class*="list"]').each((i, el) => {
        const $el = $(el);
        const itemCount = $el.children('li, .item, [class*="item"]').length;
        if (itemCount >= 3) {
            selectors.lists.push({
                container: getFullSelector($el),
                itemCount,
                sample: $el.children().first().text().trim().substring(0, 50)
            });
        }
    });

    // Find grouped links (navigation, chapter lists, etc.)
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

    // Keep only groups with 3+ links
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
    $('h1, h2, h3').each((i, el) => {
        const $el = $(el);
        selectors.headings.push({
            tag: el.tagName.toLowerCase(),
            selector: getFullSelector($el),
            text: $el.text().trim().substring(0, 80)
        });
    });

    // Find main images
    $('img[src]').each((i, el) => {
        const $el = $(el);
        const src = $el.attr('src');
        if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
            selectors.images.push({
                selector: getFullSelector($el),
                src: src.substring(0, 100),
                alt: $el.attr('alt')?.substring(0, 50)
            });
        }
    });

    return selectors;
}

/**
 * Get a full CSS selector for an element
 */
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
                .filter(c => c && c.length < 30 && !c.match(/^(js-|is-|has-)/))
                .slice(0, 1)[0];
            if (mainClass) part += `.${mainClass}`;
        }

        parts.unshift(part);
        current = current.parent();

        // Stop if we hit an ID (unique enough)
        if (id) break;
    }

    return parts.join(' > ');
}

// ============================================================================
// Output Generation
// ============================================================================

/**
 * Generate condensed HTML output
 */
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
    lines.push('    .section-title { color: #569cd6; font-size: 14px; margin-bottom: 10px; }');
    lines.push('    .path { color: #9cdcfe; }');
    lines.push('    .tag { color: #4ec9b0; }');
    lines.push('    .text { color: #ce9178; }');
    lines.push('    .data { background: #264f78; padding: 2px 5px; border-radius: 2px; }');
    lines.push('    .count { color: #b5cea8; }');
    lines.push('    .href { color: #6a9955; }');
    lines.push('    .indent { margin-left: 20px; }');
    lines.push('    .node { margin: 3px 0; padding: 2px 0; border-left: 1px solid #3c3c3c; padding-left: 10px; }');
    lines.push('    .selector-box { background: #1e1e1e; padding: 10px; margin: 5px 0; border-radius: 4px; }');
    lines.push('    .copy-btn { cursor: pointer; background: #0e639c; color: white; border: none; padding: 2px 8px; border-radius: 2px; font-size: 11px; }');
    lines.push('    pre { margin: 0; white-space: pre-wrap; word-break: break-all; }');
    lines.push('  </style>');
    lines.push('</head>');
    lines.push('<body>');

    // URL info
    lines.push(`<h2 style="color:#dcdcaa">Source URL: <span style="color:#ce9178">${escapeHtml(url)}</span></h2>`);
    lines.push(`<p style="color:#6a9955">Generated: ${new Date().toISOString()}</p>`);

    // Likely data selectors section
    lines.push('<div class="section">');
    lines.push('  <div class="section-title">== LIKELY DATA SELECTORS ==</div>');

    // Link groups (most useful for novel sources)
    if (selectors.links.length > 0) {
        lines.push('  <h3 style="color:#c586c0">Link Groups (chapters, navigation):</h3>');
        selectors.links.slice(0, 10).forEach(group => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="path">${escapeHtml(group.container)}</span> <span class="count">[${group.count} links]</span></div>`);
            group.samples.forEach(s => {
                lines.push(`    <div class="indent">- <span class="text">"${escapeHtml(s.text)}"</span> <span class="href">${escapeHtml(s.href || '')}</span></div>`);
            });
            lines.push('  </div>');
        });
    }

    // Headings
    if (selectors.headings.length > 0) {
        lines.push('  <h3 style="color:#c586c0">Headings (title, chapter names):</h3>');
        selectors.headings.slice(0, 5).forEach(h => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="tag">${h.tag}</span> <span class="path">${escapeHtml(h.selector)}</span></div>`);
            lines.push(`    <div class="indent text">"${escapeHtml(h.text)}"</div>`);
            lines.push('  </div>');
        });
    }

    // Lists
    if (selectors.lists.length > 0) {
        lines.push('  <h3 style="color:#c586c0">List Structures:</h3>');
        selectors.lists.slice(0, 5).forEach(list => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="path">${escapeHtml(list.container)}</span> <span class="count">[${list.itemCount} items]</span></div>`);
            if (list.sample) {
                lines.push(`    <div class="indent text">Sample: "${escapeHtml(list.sample)}"</div>`);
            }
            lines.push('  </div>');
        });
    }

    // Images
    if (selectors.images.length > 0) {
        lines.push('  <h3 style="color:#c586c0">Images (covers):</h3>');
        selectors.images.slice(0, 5).forEach(img => {
            lines.push('  <div class="selector-box">');
            lines.push(`    <div><span class="path">${escapeHtml(img.selector)}</span></div>`);
            lines.push(`    <div class="indent href">${escapeHtml(img.src)}</div>`);
            if (img.alt) lines.push(`    <div class="indent text">alt: "${escapeHtml(img.alt)}"</div>`);
            lines.push('  </div>');
        });
    }

    lines.push('</div>');

    // Full structure tree
    lines.push('<div class="section">');
    lines.push('  <div class="section-title">== FULL STRUCTURE TREE ==</div>');
    lines.push('  <pre>');

    const dataNodes = structure.filter(n => n.isData || n.childCount > 2);
    dataNodes.forEach(node => {
        const indent = '  '.repeat(node.depth);
        const dataMarker = node.isData ? '<span class="data">DATA</span> ' : '';
        const countInfo = node.count > 1 ? ` <span class="count">x${node.count}</span>` : '';
        const textInfo = node.text ? ` <span class="text">"${escapeHtml(node.text)}"</span>` : '';
        const hrefInfo = node.href ? ` <span class="href">[${escapeHtml(node.href)}]</span>` : '';

        lines.push(`${indent}${dataMarker}<span class="tag">${node.tag}</span> <span class="path">${escapeHtml(node.selector)}</span>${countInfo}${textInfo}${hrefInfo}`);
    });

    lines.push('  </pre>');
    lines.push('</div>');

    // Raw condensed selectors for quick copy
    lines.push('<div class="section">');
    lines.push('  <div class="section-title">== QUICK COPY SELECTORS ==</div>');
    lines.push('  <pre style="color:#9cdcfe">');

    // Unique selectors for data nodes
    const uniqueSelectors = [...new Set(
        structure
            .filter(n => n.isData)
            .map(n => n.path)
    )];
    uniqueSelectors.slice(0, 30).forEach(sel => {
        lines.push(escapeHtml(sel));
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
HTML Structure Extractor
========================
Paste your URLs below (one per line).
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
                // Extract URLs from the line (handles pasted text with multiple URLs)
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

    // If no arguments, go interactive
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

    // Get domain from first URL for output folder
    const domain = new URL(urls[0]).hostname;
    const outputDir = path.join('html-output', domain);

    console.log(`\nHTML Structure Extractor`);
    console.log(`========================`);
    console.log(`URLs to process: ${urls.length}`);
    console.log(`Output directory: ${outputDir}\n`);

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Process each URL
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];

        try {
            // Fetch page
            const html = await fetchPage(url);
            console.log(`  Analyzing structure...`);

            // Process HTML
            const { structure, selectors } = processHtml(html, url);

            // Generate output
            const output = generateOutput(url, structure, selectors);

            // Determine filename
            let filename;
            try {
                const urlObj = new URL(url);
                const pathPart = urlObj.pathname.replace(/\//g, '_').replace(/^_/, '') || 'index';
                const queryPart = urlObj.search ? '_' + urlObj.search.replace(/[?&=]/g, '_').substring(0, 30) : '';
                filename = `${pathPart}${queryPart}.html`.replace(/[<>:"|?*]/g, '_');
            } catch {
                filename = `page-${i + 1}.html`;
            }

            // Write output
            const outputPath = path.join(outputDir, filename);
            await fs.writeFile(outputPath, output, 'utf-8');
            console.log(`  Saved: ${outputPath}\n`);

        } catch (error) {
            console.error(`  Error processing ${url}: ${error.message}\n`);
        }
    }

    console.log(`Done! Check ${outputDir}/ for output files.`);
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
