// Screenshots for 0.4 U6: the Preview tab with and without the size bar, and the tab order for documentTabs.
// Reuses the fake API of tools/doc-evidence/server.mjs, adding an image document (d3) through request interception.
// Usage: PLAYWRIGHT_DIR=/path/to/node_modules/playwright node tools/doc-tabs/shoot.mjs
// (needs `npm run build` and `node tools/doc-tabs/build.mjs` first). Dev tooling only; not published.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, '..', '..', 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const PORT = 4182;
const server = spawn('node', [join(here, '..', 'doc-evidence', 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const base = `http://localhost:${PORT}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:28px}</style>
<link rel="stylesheet" href="/dist/styles.css"></head><body><div id="root"></div><script type="module" src="/tools/doc-tabs/out/main.js"></script></body></html>`;
const IMG = { id: 'd3', filename: 'site-photo.png', content_type: 'image/png', size_bytes: 20480, folder_id: '22222222-2222-4222-8222-222222222221',
  parse_status: 'parsed', created_at: '2026-10-27T09:12:00Z', edited_at: null, parsed_at: '2026-10-27T09:12:04Z', has_site: false,
  preview_sizes: ['small', 'medium', 'large'] };
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#dbe7f3"/><circle cx="320" cy="190" r="110" fill="#6b8fb5"/><text x="320" y="360" font-size="28" text-anchor="middle" font-family="sans-serif" fill="#25405c">site-photo.png</text></svg>`;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ args: ['--headless=new'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route(`${base}/doc-tabs.html*`, (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await ctx.route(/\/api\/shelf\/files\/d3(\/.*)?$/, (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^.*\/files\/d3/, '');
    if (p === '') return json(r, { ...IMG, parsed_text: '', parsed_meta: {} });
    if (p === '/site') return json(r, { code: 'not_found', message: 'no site' }, 404);
    return r.fulfill({ contentType: 'image/svg+xml', body: SVG });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  const shot = async (name, query, tab, extra) => {
    await page.goto(`${base}/doc-tabs.html?${query}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (tab) await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.fonts.ready);
    if (extra) await extra();
    await page.screenshot({ path: join(out, `doc-tabs-${name}-1280.png`) });
    console.log('wrote', `doc-tabs-${name}-1280.png`, 'tabs:', JSON.stringify(await page.getByRole('tab').allTextContents()),
      'size buttons:', await page.locator('.shelf-sdk__layout-toggle-btn').count());
  };
  await shot('preview-sizes-default', 'doc=d3', 'Preview');
  await shot('preview-sizes-off', 'doc=d3&sizes=0', 'Preview');
  await shot('order-content-preview-text', 'doc=d2&tabs=content,preview,text', null, async () => {
    console.log('selected tab:', await page.getByRole('tab', { selected: true }).textContent());
  });
} finally {
  await browser.close();
  server.kill();
}
