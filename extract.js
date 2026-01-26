#!/usr/bin/env node

/**
 * HTML Structure Extractor - LLM-optimized output
 * Produces condensed selectors for easy scraping config creation
 */

import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

const CONFIG = {
    removeTags: ['script', 'style', 'noscript', 'iframe', 'svg', 'meta', 'link', 'head', 'br', 'hr', 'input', 'button'],
    maxText: 60,
    jsWaitTime: 5000, // Wait for JS-rendered content
    browser: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
};

let browser = null;

async function getBrowser() {
    if (!browser) {
        console.log('  Starting browser...');
        browser = await puppeteer.launch(CONFIG.browser);
    }
    return browser;
}

async function closeBrowser() {
    if (browser) { await browser.close(); browser = null; }
}

async function fetchPage(url) {
    console.log(`  Fetching: ${url}`);
    const b = await getBrowser();
    const page = await b.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setRequestInterception(true);
        page.on('request', r => ['image', 'font', 'media', 'stylesheet'].includes(r.resourceType()) ? r.abort() : r.continue());
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        console.log(`  Waiting ${CONFIG.jsWaitTime / 1000}s for JS content...`);
        await new Promise(r => setTimeout(r, CONFIG.jsWaitTime));
        return await page.content();
    } finally { await page.close(); }
}

function sel($el) {
    const tag = $el[0]?.tagName?.toLowerCase();
    if (!tag) return '';
    const id = $el.attr('id');
    const cls = $el.attr('class');
    if (id) return `${tag}#${id.replace(/\d+/g, 'N')}`;
    if (cls) {
        const c = cls.split(/\s+/).filter(x => x && x.length < 25 && !/^(js-|is-|has-|active|hidden|show|col-|row|clearfix|pull-)/.test(x))[0];
        if (c) return `${tag}.${c}`;
    }
    return tag;
}

function fullPath($el, $) {
    const parts = [];
    let cur = $el;
    while (cur.length && cur[0]?.tagName) {
        const tag = cur[0].tagName.toLowerCase();
        if (tag === 'html' || tag === 'body') break;
        parts.unshift(sel(cur));
        if (cur.attr('id')) break;
        cur = cur.parent();
    }
    return parts.filter(Boolean).join('>');
}

function txt($el) {
    const t = $el.clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
    return t.length > CONFIG.maxText ? t.slice(0, CONFIG.maxText) + '…' : t;
}

function analyze(html, url) {
    const $ = cheerio.load(html);
    CONFIG.removeTags.forEach(t => $(t).remove());
    $('[style*="display:none"],[style*="display: none"],.hidden,[hidden]').remove();

    const out = [];
    const domain = new URL(url).origin;

    out.push(`URL: ${url}`);
    out.push(`\n=== HEADINGS ===`);
    $('h1,h2,h3,h4').each((i, el) => {
        const $el = $(el);
        const t = $el.text().replace(/\s+/g, ' ').trim();
        if (t) out.push(`${sel($el)} "${t.slice(0, 80)}"`);
    });

    out.push(`\n=== LINK GROUPS ===`);
    const linkGroups = {};
    $('a[href]').each((i, el) => {
        const $el = $(el);
        const $p = $el.parent();
        const pSel = fullPath($p, $);
        if (!linkGroups[pSel]) linkGroups[pSel] = [];
        linkGroups[pSel].push({ text: txt($el), href: $el.attr('href') });
    });
    Object.entries(linkGroups)
        .filter(([, links]) => links.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 15)
        .forEach(([pSel, links]) => {
            out.push(`\n${pSel} [${links.length} links]`);
            links.slice(0, 3).forEach(l => out.push(`  a "${l.text}" → ${l.href}`));
        });

    out.push(`\n=== IMAGES ===`);
    $('img[src]').each((i, el) => {
        const $el = $(el);
        const src = $el.attr('src') || '';
        if (src && !/icon|logo|avatar|pixel|data:/.test(src)) {
            out.push(`${fullPath($el, $)} src="${src.slice(0, 80)}"`);
        }
    });

    out.push(`\n=== TEXT BLOCKS ===`);
    $('p,div.content,[class*="chapter"],[class*="content"],[id*="content"]').each((i, el) => {
        const $el = $(el);
        const t = $el.text().replace(/\s+/g, ' ').trim();
        if (t.length > 100) {
            out.push(`${fullPath($el, $)} "${t.slice(0, 100)}…"`);
        }
    });

    out.push(`\n=== LISTS ===`);
    $('ul,ol,[class*="list"]').each((i, el) => {
        const $el = $(el);
        const items = $el.children('li,a,[class*="item"]').length;
        if (items >= 3) {
            out.push(`${fullPath($el, $)} [${items} items]`);
        }
    });

    out.push(`\n=== STRUCTURE ===`);
    const seen = new Set();
    function walk($el, depth) {
        if (depth > 8) return;
        $el.children().each((i, child) => {
            const $c = $(child);
            const tag = child.tagName?.toLowerCase();
            if (!tag || CONFIG.removeTags.includes(tag)) return;
            const s = sel($c);
            const t = txt($c);
            const childCount = $c.children().length;
            const key = `${depth}:${s}`;

            if (!seen.has(key) && (t || childCount > 0)) {
                seen.add(key);
                const indent = '  '.repeat(depth);
                const textPart = t ? ` "${t}"` : '';
                const countPart = childCount > 2 ? ` (${childCount})` : '';
                out.push(`${indent}${s}${countPart}${textPart}`);
            }
            walk($c, depth + 1);
        });
    }
    walk($('body'), 0);

    return out.join('\n');
}

async function main() {
    let args = process.argv.slice(2);

    // Read from extract_text.txt if no command line args
    if (!args.length) {
        try {
            const fileContent = await fs.readFile('extract_urls.txt', 'utf-8');
            const fileUrls = fileContent.match(/https?:\/\/[^\s"'<>]+/g) || [];
            if (fileUrls.length) {
                console.log(`\nRead ${fileUrls.length} URLs from extract_urls.txt`);
                args = fileUrls;
            }
        } catch {
            console.log('No extract_text.txt file found. Create it with URLs to extract.');
            process.exit(1);
        }
    }

    if (!args.length) {
        console.log('No URLs found in extract_text.txt.');
        process.exit(1);
    }

    const urls = args.map(a => { try { return new URL(a).href; } catch { return null; } }).filter(Boolean);
    if (!urls.length) { console.log('No valid URLs.'); process.exit(1); }

    const domain = new URL(urls[0]).hostname;
    const outDir = path.join('html-output', domain);
    await fs.mkdir(outDir, { recursive: true });

    console.log(`\nProcessing ${urls.length} URLs → ${outDir}\n`);

    try {
        for (let i = 0; i < urls.length; i++) {
            try {
                const html = await fetchPage(urls[i]);
                console.log(`  Analyzing...`);
                const output = analyze(html, urls[i]);

                const urlObj = new URL(urls[i]);
                const fname = (urlObj.pathname.replace(/\//g, '_').replace(/^_/, '') || 'index') +
                    (urlObj.search ? urlObj.search.replace(/[?&=]/g, '_').slice(0, 30) : '') + '.txt';

                await fs.writeFile(path.join(outDir, fname.replace(/[<>:"|?*]/g, '_').slice(0, 80)), output);
                console.log(`  ✓ Saved: ${fname}\n`);
            } catch (e) { console.log(`  ✗ ${e.message}\n`); }
        }
    } finally { await closeBrowser(); }

    console.log(`Done! Check ${outDir}/`);
}

main().catch(e => { console.error(e); closeBrowser(); process.exit(1); });
