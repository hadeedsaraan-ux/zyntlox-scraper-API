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
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        // Go to URL
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        // Clean-up: Remove banners/popups before screenshot
        await page.evaluate(() => {
            const selectors = ['#cookie-consent', '.cookie-banner', '[id*="cookie"]', '[class*="banner"]', '[id*="modal"]'];
            selectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => el.remove());
            });
        });

        // Screenshot logic
        const screenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // Get HTML for Markdown
        const rawHtml = await page.content();
        const $ = cheerio.load(rawHtml);
        
        let responseData = { url, status: 'success', screenshot: `data:image/png;base64,${screenshot}` };

        // RAG/Markdown processing
        if (mode === 'rag') {
            $('nav, footer, header, script, style, iframe, noscript, form, svg, .cookie-banner').remove();
            responseData.clean_markdown = turndownService.turndown($.html()).substring(0, 15000);
        } else {
            responseData.title = $('title').text();
        }

        await browser.close();
        return res.status(200).json(responseData);

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
