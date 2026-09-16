const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const TurndownService = require('turndown');

puppeteer.use(StealthPlugin());
const turndownService = new TurndownService();

module.exports = async function (req, res) {
    const { url, mode } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        // Anti-bot headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });

        // Load page with wait until network idle
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Extra human-like delay
        await new Promise(r => setTimeout(r, 3000));

        const rawHtml = await page.content();
        const $ = cheerio.load(rawHtml);

        // Remove useless tags
        $('script, style, iframe, noscript').remove();

        const cleanMarkdown = turndownService.turndown($.html());
        
        await browser.close();
        return res.status(200).json({
            url,
            title: $('title').text(),
            clean_markdown: cleanMarkdown.substring(0, 10000), // Limit to avoid crashes
            status: 'success'
        });

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const TurndownService = require('turndown');

// Stealth setup
puppeteer.use(StealthPlugin());

const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

module.exports = async function (req, res) {
    const { url, mode } = req.query;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        
        // Randomize User Agent to stay hidden
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

        // Block resources that slow down scraping or leak bot identity
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['font', 'media', 'stylesheet', 'image'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const rawHtml = await page.content();
        const $ = cheerio.load(rawHtml);

        // Metadata extraction
        const metadata = {
            title: $('title').text(),
            description: $('meta[name="description"]').attr('content')
        };

        // RAG Logic: Cleaned Data for AI
        if (mode === 'rag') {
            // Remove noise
            $('nav, footer, header, script, style, iframe, noscript, form, svg, .cookie-banner').remove();
            
            const cleanMarkdown = turndownService.turndown($.html());
            
            await browser.close();
            return res.status(200).json({
                url,
                metadata,
                clean_markdown: cleanMarkdown,
                status: 'success'
            });
        }

        // Normal Mode: Full data
        await browser.close();
        return res.status(200).json({ url, metadata, status: 'success' });

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
