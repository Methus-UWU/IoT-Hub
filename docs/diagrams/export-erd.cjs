const { chromium } = require('../../frontend/node_modules/playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

(async () => {
  const meta = JSON.parse(readFileSync(path.join(__dirname, 'iot-hub-erd-data.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: meta.width, height: 1200 }, deviceScaleFactor: 1.5 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'iot-hub-erd.html')).href);
    await page.evaluate(width => { document.querySelector('#diagram').style.width = width + 'px'; }, meta.width);
    const clipped = await page.locator('.entity').evaluateAll(tables => tables.flatMap(table => {
      const boundary = table.querySelector('rect').getBBox();
      return [...table.querySelectorAll('text')].filter(text => {
        const b = text.getBBox();
        return b.x < boundary.x || b.x + b.width > boundary.x + boundary.width || b.y + b.height > boundary.y + boundary.height;
      }).map(t => t.textContent);
    }));
    assert.deepEqual(clipped, [], 'Table text must fit inside cards');
    assert.equal(await page.locator('.entity').count(), meta.publicTables + 1);
    assert.equal(await page.locator('.relation').count(), meta.relations.length);
    await page.locator('[data-name="users"]').click();
    assert(await page.locator('.relation.focus').count() > 0, 'Highlight must select relationships');
    await page.locator('#reset').click();
    assert.equal(await page.locator('.dim,.focus').count(), 0);
    assert.deepEqual(errors, []);
    await page.locator('#diagram svg').screenshot({ path: path.join(__dirname, 'iot-hub-erd.png') });
    await page.evaluate(() => {
      document.querySelector('header').remove();
      document.querySelector('details').remove();
      document.querySelector('main').style.padding = '0';
      document.querySelector('#diagram').style.margin = '0';
    });
    await page.pdf({ path: path.join(__dirname, 'iot-hub-erd.pdf'), width: `${meta.width}px`, height: `${meta.height}px`, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    await page.locator('#diagram').evaluate(el => { el.style.width = '1000px'; });
    await page.locator('#diagram svg').screenshot({ path: path.join(__dirname, 'iot-hub-erd-preview.png') });
    console.log('Verified entity and FK counts, text bounds, interactive highlighting, and browser errors. Exported PNG and PDF.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
