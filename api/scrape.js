const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const TurndownService = require('turndown');

puppeteer.use(StealthPlugin());
const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

module.exports = async function (req, res) {
    const { url, mode } = req.query;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-blink-features=AutomationControlled',
                '--window-size=1280,800'
            ]
        });

        const page = await browser.newPage();
        
        // Human-like browser behavior
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        // Block media/fonts to bypass detection and increase speed
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['font', 'media', 'stylesheet', 'image'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Navigate with human-like delays
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000)); 

        const rawHtml = await page.content();
        const $ = cheerio.load(rawHtml);
        const title = $('title').text();

        // RAG Logic
        if (mode === 'rag') {
            $('nav, footer, header, script, style, iframe, noscript, form, svg, .cookie-banner, #cookie-consent').remove();
            const cleanMarkdown = turndownService.turndown($.html());
            
            await browser.close();
            return res.status(200).json({
                url,
                title,
                clean_markdown: cleanMarkdown.substring(0, 15000),
                status: 'success'
            });
        }

        await browser.close();
        return res.status(200).json({ url, title, status: 'success' });

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
