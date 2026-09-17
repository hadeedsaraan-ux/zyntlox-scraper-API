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
        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800'
        ];

        if (process.env.PROXY_ADDRESS) {
            launchArgs.push(`--proxy-server=${process.env.PROXY_ADDRESS}`);
        }

        browser = await puppeteer.launch({
            headless: 'new',
            args: launchArgs
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        if (process.env.PROXY_USER && process.env.PROXY_PASS) {
            await page.authenticate({
                username: process.env.PROXY_USER,
                password: process.env.PROXY_PASS
            });
        }

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Kill Popups & Banners
        await page.evaluate(() => {
            document.querySelectorAll('*').forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'sticky' || parseInt(style.zIndex) > 90) {
                    el.remove();
                }
            });
        });

        // FIXED: Removed fullPage: true to prevent memory crash on cloud servers
        const screenshot = await page.screenshot({ encoding: 'base64' });
        const html = await page.content();
        const $ = cheerio.load(html);

        const metadata = {
            title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
            description: $('meta[name="description"]').attr('content') || '',
            headings: {
                h1: $('h1').map((i, el) => $(el).text().trim()).get(),
                h2: $('h2').map((i, el) => $(el).text().trim()).get()
            },
            links: $('a[href]').map((i, el) => ({
                text: $(el).text().trim(),
                href: $(el).attr('href')
            })).get().slice(0, 50),
            images: $('img').map((i, el) => ({
                src: $('img').attr('src'),
                alt: $('img').attr('alt') || ''
            })).get().slice(0, 20),
            canonical: $('link[rel="canonical"]').attr('href') || ''
        };

        let response = {
            url,
            status: 'success',
            screenshot: `data:image/png;base64,${screenshot}`,
            metadata
        };

        if (mode === 'rag') {
            $('script, style, nav, footer, header, svg, iframe').remove();
            response.clean_markdown = turndownService.turndown($.html()).substring(0, 15000);
        }

        await browser.close();
        return res.status(200).json(response);

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
};
