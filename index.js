const express = require('express');
const app = express();
const scrape = require('./api/scrape');

app.get('/scrape', async (req, res) => {
    // Ye line aapke function ko call karegi
    await scrape(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Zyntlox Scraper is live on port ${PORT}`);
});
