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
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });

        // Screenshot
        const screenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // HTML content
        const html = await page.content();
        const $ = cheerio.load(html);
        
        // Metadata & Content
        const title = $('title').text() || 'No Title';
        const description = $('meta[name="description"]').attr('content') || '';

        let response = { 
            url, 
            status: 'success', 
            screenshot: `data:image/png;base64,${screenshot}`,
            metadata: { title, description }
        };

        if (mode === 'rag') {
            $('script, style, nav, footer, header, .cookie-banner').remove();
            response.clean_markdown = turndownService.turndown($.html());
        }

        await browser.close();
        return res.status(200).json(response);

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
