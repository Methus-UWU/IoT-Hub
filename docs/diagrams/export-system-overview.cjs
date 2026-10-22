// Renders the Mermaid diagram in docs/ARCHITECTURE.md § "System Overview" to
// system-overview.png, for readers whose viewer cannot render Mermaid.
// The Markdown block stays the single source; re-run after editing it.
const { chromium } = require('../../frontend/node_modules/playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';

(async () => {
  const markdown = readFileSync(path.join(__dirname, '../ARCHITECTURE.md'), 'utf8');
  const source = markdown.match(/# System Overview[\s\S]*?```mermaid\n([\s\S]*?)```/)?.[1];
  assert(source, 'System Overview Mermaid block not found');

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await page.setContent('<!doctype html><body style="margin:0;background:#fff"><div id="out"></div></body>');
    await page.addScriptTag({ url: MERMAID });
    await page.evaluate(async text => {
      window.mermaid.initialize({ startOnLoad: false, theme: 'default', flowchart: { htmlLabels: true } });
      const { svg } = await window.mermaid.render('overview', text);
      document.querySelector('#out').innerHTML = svg;
    }, source);
    await page.locator('#out svg').screenshot({ path: path.join(__dirname, 'system-overview.png') });
    console.log('Exported system-overview.png');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
