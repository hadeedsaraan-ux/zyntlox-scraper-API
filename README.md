# 🚀 Zyntlox AI & RAG Scraper API

> Turn any website into token-optimized Markdown and clean, popup-free screenshots instantly. Built specifically for Large Language Models (LLMs) and RAG (Retrieval-Augmented Generation) pipelines.

---

## 🎯 Why Zyntlox?
AI developers don’t want messy HTML tags, cookie banners, navigationbars, or tracking scripts bloating their context windows. They want **clean semantic data**. 

Zyntlox scrapes target URLs, strips all the noise, kills floating popups automatically, extracts rich metadata, and returns a developer-first JSON payload ready for AI ingestion.

---

## 🛠️ Features
- **Markdown by Default:** Instantly converts page bodies into clean markdown chunks.
- **Universal Popup Killer:** Automatically removes fixed/sticky cookie banners and overlays before screenshotting.
- **Structured Metadata:** Extracts page title, description, canonical URL, and primary `<h1>`/`<h2>` headings.
- **Visual Context:** Returns a clean full-page base64 screenshot alongside the text.
- **Anti-Bot Evasions:** Powered by `puppeteer-extra-plugin-stealth` to bypass standard bot detection layers.

---

## 📦 API Endpoint & Usage

You can test and integrate this API directly via RapidAPI:

🔗 **[Get API Key & Test on RapidAPI](https://rapidapi.com/bibliappnovels/api/zyntlox-ai-rag-scraper/playground/Scrape%20Page%20(AI%20%26%20Markdown))**

### Endpoint
`GET /scrape`

### Query Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `url` | String | **Yes** | The target website URL you want to scrape. |

---

## 💡 Example Response

```json
{
  "success": true,
  "source_url": "https://en.wikipedia.org/wiki/Artificial_intelligence",
  "metadata": {
    "title": "Artificial intelligence - Wikipedia",
    "description": "",
    "headings": {
      "h1": ["Artificial intelligence"],
      "h2": ["Goals", "Techniques", "Applications", "Ethics"]
    },
    "linksCount": 5792,
    "imagesCount": 43,
    "canonical": "https://en.wikipedia.org/wiki/Artificial_intelligence"
  },
  "markdown_content": "# Artificial intelligence...",
  "screenshot": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
}
---

## ⚙️ Tech Stack
- **Node.js & Express** (API Server)
- **Puppeteer-Extra & Stealth** (Browser Automation & Anti-Bot)
- **Cheerio & Turndown** (DOM Parsing & HTML-to-Markdown conversion)
- **Railway** (Cloud Infrastructure)

---

## 📄 License
This project is licensed under the MIT License.
