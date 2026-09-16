const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const TurndownService = require('turndown');

// Initialize Stealth & Turndown
puppeteer.use(StealthPlugin());
const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

module.exports = async function (req, res) {
    const { url, mode } = req.query;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

        // Speed: Block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['font', 'media', 'stylesheet', 'image'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Anti-bot wait: Let page settle
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000)); // Short human delay

        const rawHtml = await page.content();
        const $ = cheerio.load(rawHtml);
        const title = $('title').text();

        // Mode: RAG (AI Optimized)
        if (mode === 'rag') {
            $('nav, footer, header, script, style, iframe, noscript, form, svg, .cookie-banner, #cookie-consent').remove();
            const cleanMarkdown = turndownService.turndown($.html());
            
            await browser.close();
            return res.status(200).json({
                url,
                title,
                clean_markdown: cleanMarkdown.substring(0, 15000), // AI friendly size
                status: 'success'
            });
        }

        // Mode: Default (Metadata only)
        await browser.close();
        return res.status(200).json({ url, title, status: 'success' });

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
