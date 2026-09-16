const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const fs = require('fs');

// Auto-scroll helper
async function autoScroll(page){
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 100;
            let timer = setInterval(() => {
                let scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if(totalHeight >= scrollHeight - window.innerHeight){
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

async function run() {
    const url = 'https://zyntlox.vercel.app/';
    console.log(`Starting Safe Scrape for: ${url}`);

    // Browser launch: Yeh aapke system ke original installed Chrome ko use karega
    const browser = await puppeteer.launch({ 
        headless: true,
        channel: 'chrome', // Aapke computer ka original Chrome
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(url, { waitUntil: 'networkidle2' });

    console.log("Scrolling page to load all elements & images...");
    await autoScroll(page);

    console.log("Taking full-page screenshot...");
    await page.screenshot({ path: 'screenshot.png', fullPage: true });

    const rawHtml = await page.content();

    console.log("Smart Cleaning HTML...");
    const $ = cheerio.load(rawHtml);
    $('script, style, iframe, noscript').remove();
    $('svg').replaceWith('<span>[SVG Icon]</span>');

    const cleanedHtml = $.html();

    console.log("Converting to Markdown...");
    const turndownService = new TurndownService();
    
    turndownService.addRule('keepAttributes', {
        filter: ['a', 'img', 'form', 'input'],
        replacement: function (content, node) {
            if (node.nodeName === 'A') {
                const href = node.getAttribute('href') || '';
                const rel = node.getAttribute('rel') || '';
                return `[${content}](${href}) (rel: ${rel})`;
            }
            if (node.nodeName === 'FORM') {
                const action = node.getAttribute('action') || '';
                const method = node.getAttribute('method') || '';
                return `\n\n[Form: Action=${action}, Method=${method}]\n${content}\n\n`;
            }
            return content;
        }
    });

    const markdown = turndownService.turndown(cleanedHtml);

    fs.writeFileSync('output.md', markdown);
    console.log("Cleaned Markdown saved as 'output.md'");

    await browser.close();
    console.log("Done! Both files created successfully.");
}

run().catch(err => console.error("Error occurred:", err));