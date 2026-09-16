const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');
const TurndownService = require('turndown');

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

// Navigation timeouts: 25s ensures heavy pages never time out prematurely
const NAV_TIMEOUT_MS = 25000;
const SETTLE_TIMEOUT_MS = 2500;

// Auto-scroll configuration: scrolls smoothly and quickly to trigger lazy loads
const SCROLL_MAX_MS = 6000;
const SCROLL_MAX_PX = 35000;
const SCROLL_HARD_LIMIT_MS = 10000;

async function autoScroll(page) {
    const scrolling = page.evaluate(
        async (maxMs, maxPx) => {
            await new Promise((resolve) => {
                const startedAt = Date.now();
                let totalHeight = 0;
                const distance = 400; // Faster, larger steps to reach footer quickly
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    const reachedBottom = totalHeight >= scrollHeight - window.innerHeight;
                    const hitPixelCap = totalHeight >= maxPx;
                    const hitTimeCap = Date.now() - startedAt > maxMs;

                    if (reachedBottom || hitPixelCap || hitTimeCap) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 40);
            });
        },
        SCROLL_MAX_MS,
        SCROLL_MAX_PX
    );

    await Promise.race([
        scrolling,
        new Promise((resolve) => setTimeout(resolve, SCROLL_HARD_LIMIT_MS)),
    ]).catch(() => {});
}

async function stripHiddenElements(page) {
    await page.evaluate(() => {
        const isHidden = (el) => {
            let node = el;
            while (node && node.nodeType === 1) {
                const style = window.getComputedStyle(node);
                if (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    parseFloat(style.opacity) === 0
                ) {
                    return true;
                }
                node = node.parentElement;
            }
            // display:contents elements always have a {0,0} bounding rect by spec —
            // the element's own box disappears while its children render normally.
            // Without this exemption the zero-size check below deletes the whole
            // subtree under any such wrapper (e.g. styled-components/emotion divs).
            if (window.getComputedStyle(el).display === 'contents') return false;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return true;
            return false;
        };

        const NEVER_RENDERED_BY_DESIGN = new Set(['title', 'desc']);
        document.querySelectorAll('body *').forEach((el) => {
            if (NEVER_RENDERED_BY_DESIGN.has(el.tagName.toLowerCase())) return;
            if (isHidden(el)) el.remove();
        });

        document.querySelectorAll('[data-scrape-ignore]').forEach((el) => el.remove());
    }).catch(() => {});
}

/**
 * Resilient live DOM extractor matching Chrome DevTools console logic.
 * Avoids rigid regex endpoints so URLs like '/privacy-policy-website/' match reliably.
 */
async function extractDomFacts(page) {
    return page.evaluate(async () => {
        // Trigger lazy-loaded images
        document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
            img.loading = 'eager';
        });

        const pendingImages = Array.from(document.querySelectorAll('img')).filter((img) => !img.complete);
        await Promise.all(
            pendingImages.map(
                (img) =>
                    new Promise((resolve) => {
                        img.addEventListener('load', resolve, { once: true });
                        img.addEventListener('error', resolve, { once: true });
                        setTimeout(resolve, 1500);
                    })
            )
        );

        // 1. IMAGES & ALT TEXT (Matches exact console logic)
        const allImgElements = Array.from(document.querySelectorAll('img'));
        const images = allImgElements.map((img) => ({
            src: img.currentSrc || img.src || '',
            alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
            hasAltAttribute: img.hasAttribute('alt'),
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
        }));

        // Accessible name helper for links
        const accessibleNameOf = (a) => {
            const text = (a.textContent || '').trim();
            if (text) return text;
            const ariaLabel = (a.getAttribute('aria-label') || '').trim();
            if (ariaLabel) return ariaLabel;
            const title = (a.getAttribute('title') || '').trim();
            if (title) return title;
            const descendantWithLabel = a.querySelector('[aria-label]');
            if (descendantWithLabel) {
                const descendantLabel = (descendantWithLabel.getAttribute('aria-label') || '').trim();
                if (descendantLabel) return descendantLabel;
            }
            const innerImg = a.querySelector('img[alt]');
            if (innerImg) {
                const innerAlt = (innerImg.getAttribute('alt') || '').trim();
                if (innerAlt) return innerAlt;
            }
            const innerSvgTitle = a.querySelector('svg title');
            if (innerSvgTitle) {
                const svgTitleText = (innerSvgTitle.textContent || '').trim();
                if (svgTitleText) return svgTitleText;
            }
            return '';
        };

        const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
            href: a.href,
            accessibleName: accessibleNameOf(a),
        }));

        return { images, links };
    }).catch(() => ({ images: [], links: [] }));
}

module.exports = async function (req, res) {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Please provide a URL parameter' });
    }

    const maxHeight = Math.max(0, Number(req.query.maxHeight) || 0);

    let browser = null;
    let navWarning = null;

    try {
        // Bundled Chromium launch (no external GitHub download, 100% local in package)
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

        // User-Agent to avoid bot blocks
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page
            .goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
            .catch((err) => {
                navWarning = `Navigation did not complete cleanly: ${err.message}`;
            });

        if (page.url() === 'about:blank') {
            throw new Error(`Could not load ${url}. ${navWarning || 'The page never navigated.'}`);
        }

        await page.waitForNetworkIdle({ idleTime: 500, timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

        // Auto Scroll to footer
        await autoScroll(page);
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Cookie & Consent popup remover. The keyword-based selectors below are bare
        // substring matches on class/id/aria-label — a footer's own "Cookie Policy" link,
        // or a wrapper div around the whole privacy/terms/cookies group (e.g.
        // id="footer-legal-consent"), matches "cookie"/"consent"/"gdpr" just as well as a
        // real banner does. Blindly hiding those wiped the very legal links the report
        // checks for, since stripHiddenElements() later deletes anything display:none.
        // Real consent banners are overlays — virtually always position:fixed/sticky —
        // while footer content is normal in-flow, so gate the keyword matches on that and
        // never touch an <a> itself. The exact vendor IDs (OneTrust, Cookiebot, etc.) are
        // precise, not substrings, so those stay unconditional.
        await page.evaluate(() => {
            const EXACT_SELECTOR =
                '#onetrust-consent-sdk, #CybotCookiebotDialog, .cc-window, .osano-cm-window';
            const KEYWORD_SELECTOR =
                '[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i], [id*="gdpr" i], [aria-label*="cookie" i]';

            document.querySelectorAll(EXACT_SELECTOR).forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
            });

            document.querySelectorAll(KEYWORD_SELECTOR).forEach((el) => {
                if (el.tagName === 'A') return;
                const position = window.getComputedStyle(el).position;
                if (position === 'fixed' || position === 'sticky') {
                    el.style.setProperty('display', 'none', 'important');
                }
            });
        }).catch(() => {});

        // Screenshot capture
        const screenshotOptions = { encoding: 'base64', type: 'png' };
        if (maxHeight > 0) {
            const fullHeight = await page.evaluate(
                () => document.documentElement.scrollHeight || document.body.scrollHeight || 0
            );
            const clipHeight = Math.min(fullHeight || VIEWPORT_HEIGHT, maxHeight);
            if (clipHeight > 0) {
                screenshotOptions.clip = {
                    x: 0,
                    y: 0,
                    width: VIEWPORT_WIDTH,
                    height: clipHeight,
                };
                screenshotOptions.captureBeyondViewport = true;
            } else {
                screenshotOptions.fullPage = true;
            }
        } else {
            screenshotOptions.fullPage = true;
        }
        const screenshotBase64 = await page.screenshot(screenshotOptions);

        // Strip CSS-hidden elements before text reading
        await stripHiddenElements(page);

        // Extract live DOM facts
        const domFacts = await extractDomFacts(page);
        const rawHtml = await page.content();

        // Cheerio extraction
        const $ = cheerio.load(rawHtml);

        const robots = [
            $('meta[name="robots"]').attr('content') || '',
            $('meta[name="googlebot"]').attr('content') || '',
        ].filter(Boolean).join(', ');

        const metadata = {
            title: $('title').first().text().trim() || '',
            description:
                $('meta[name="description"]').attr('content') ||
                $('meta[property="og:description"]').attr('content') ||
                '',
            has_viewport: $('meta[name="viewport"]').length > 0,
            viewport_content: $('meta[name="viewport"]').attr('content') || '',
            has_canonical: $('link[rel="canonical"]').length > 0,
            canonical_url: $('link[rel="canonical"]').attr('href') || '',
            robots: robots,
            is_noindex: /\bnoindex\b/i.test(robots),
            lang: $('html').attr('lang') || '',
            has_favicon: $('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length > 0,
            og_title: $('meta[property="og:title"], meta[name="og:title"]').attr('content') || '',
            og_description: $('meta[property="og:description"], meta[name="og:description"]').attr('content') || '',
            og_image: $('meta[property="og:image"], meta[name="og:image"]').attr('content') || '',
            h1_count: $('h1').length,
            total_images: $('img').length,
            images_missing_alt: $('img:not([alt]), img[alt=""]').length,
            is_https: url.startsWith('https'),
        };

        // Schema detection for Content vs Storefront
        let hasNewsSchema = false;
        let hasProductSchema = false;
        let structuredAddress = null;

        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const text = $(el).text();
                if (!text) return;
                const json = JSON.parse(text);
                const str = JSON.stringify(json).toLowerCase();
                if (str.includes('newsarticle') || str.includes('newsmediaorganization')) {
                    hasNewsSchema = true;
                }
                if (str.includes('"product"') || str.includes('"offer"')) {
                    hasProductSchema = true;
                }
                if (!structuredAddress && str.includes('streetaddress')) {
                    const findAddr = (obj) => {
                        if (!obj || typeof obj !== 'object') return null;
                        if (obj.streetAddress) {
                            return [obj.streetAddress, obj.addressLocality, obj.postalCode, obj.addressCountry].filter(Boolean).join(', ');
                        }
                        for (const key of Object.keys(obj)) {
                            const found = findAddr(obj[key]);
                            if (found) return found;
                        }
                        return null;
                    };
                    structuredAddress = findAddr(json);
                }
            } catch {}
        });

        const hasCommerceButtons = $('button, a').toArray().some(el => {
            const text = $(el).text().toLowerCase();
            return /\b(add to (cart|bag)|buy (now|it)|checkout)\b/i.test(text);
        });

        const commerceSignals = {
            hasProductSchema,
            hasNewsSchema,
            hasCommerceButtons,
        };

        // Clean HTML for Markdown
        $('script, style, iframe, noscript').remove();
        $('svg').replaceWith('<span>[SVG Icon]</span>');

        const cleanedHtml = $.html();

        // Convert to Markdown
        const turndownService = new TurndownService();
        turndownService.addRule('keepAttributes', {
            filter: ['a', 'img', 'form', 'input'],
            replacement: function (content, node) {
                if (node.nodeName === 'A') {
                    const href = node.getAttribute('href') || '';
                    const rel = node.getAttribute('rel') || '';
                    return rel ? `[${content}](${href}) (rel: ${rel})` : `[${content}](${href})`;
                }
                if (node.nodeName === 'FORM') {
                    const action = node.getAttribute('action') || '';
                    const method = node.getAttribute('method') || '';
                    return `\n\n[Form: Action=${action}, Method=${method}]\n${content}\n\n`;
                }
                if (node.nodeName === 'IMG') {
                    const src = node.getAttribute('src') || '';
                    const alt = (node.getAttribute('alt') || '').trim();
                    return src ? `![${alt}](${src})` : '';
                }
                if (node.nodeName === 'INPUT') {
                    const type = (node.getAttribute('type') || 'text').toLowerCase();
                    if (type === 'hidden') return '';
                    const label = node.getAttribute('aria-label') || node.getAttribute('placeholder') || '';
                    return `[Input: type=${type}${label ? `, label=${label}` : ''}]`;
                }
                return content;
            }
        });

        const markdown = turndownService.turndown(cleanedHtml);

        await browser.close();
        browser = null;

        return res.status(200).json({
            screenshot: `data:image/png;base64,${screenshotBase64}`,
            markdown: markdown,
            html: rawHtml,
            metadata: metadata,
            images: domFacts.images,
            links: domFacts.links,
            commerceSignals: commerceSignals,
            structuredAddress: structuredAddress,
            warning: navWarning,
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
};
