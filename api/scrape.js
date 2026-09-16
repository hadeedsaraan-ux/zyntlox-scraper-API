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
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Kill Popups & Banners
        await page.evaluate(() => {
            const badElements = document.querySelectorAll('*');
            badElements.forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'sticky' || parseInt(style.zIndex) > 90) {
                    el.remove();
                }
            });
        });

        const screenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });
        const html = await page.content();
        const $ = cheerio.load(html);
        
        // Advanced Metadata (The Value that developers pay for)
        const metadata = {
            title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
            description: $('meta[name="description"]').attr('content') || '',
            headings: {
                h1: $('h1').map((i, el) => $(el).text().trim()).get(),
                h2: $('h2').map((i, el) => $(el).text().trim()).get()
            },
            links: $('a').length,
            images: $('img').length,
            tables: $('table').length,
            canonical: $('link[rel="canonical"]').attr('href') || ''
        };

        let response = { url, status: 'success', screenshot: `data:image/png;base64,${screenshot}`, metadata };

        if (mode === 'rag') {
            $('script, style, nav, footer, header, svg, iframe').remove();
            // Convert tables to markdown cleanly
            response.clean_markdown = turndownService.turndown($.html());
        }

        await browser.close();
        return res.status(200).json(response);

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
