// P3: long file and folder names must wrap or ellipsize and never overflow their container.
// Loads the fake API's /api/shelflong fixtures (unbroken 70+ char names, long names with spaces) at 1280/900/375 px,
// in a plain and a hostile host, in gallery, list, sub-folder (crumbs) and document views.
// Usage: node wrap.mjs [shotsDir]   (shotsDir: also saves screenshots named wrap-<view>-<width>[-hostile].png)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4175, base = `http://localhost:${PORT}`;
const srv = spawn('node', [here + 'serve.mjs'], { env: { ...process.env, PORT }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
let failures = 0;

// Every element that shows a file or folder name.
const NAME = '.shelf-sdk__file-card-name, .shelf-sdk__file-card-link, .shelf-sdk__item-name-text, .shelf-sdk__folder-tile-name, .shelf-sdk__breadcrumb, .shelf-sdk__doc-title .shelf-sdk__section-title, .shelf-sdk__folder-tree-name, .shelf-sdk__preview-facts dd, .shelf-sdk__studio-actions span';

async function check(page, label) {
  const r = await page.evaluate((NAME) => {
    const out = [];
    const sdk = document.querySelector('.shelf-sdk');
    const sb = sdk.getBoundingClientRect();
    // 5px of tolerance: the rail layout's dropzone deliberately bleeds 5px past each side (web's margin-inline: -5px, zeroed at <= 640px), which is not a name.
    if (sdk.scrollWidth > sdk.clientWidth + 5) out.push(`embed scrolls horizontally: scrollWidth ${sdk.scrollWidth} > clientWidth ${sdk.clientWidth}`);
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.push(`page scrolls horizontally: ${de.scrollWidth} > ${de.clientWidth}`);
    let n = 0;
    for (const el of sdk.querySelectorAll(NAME)) {
      if (!el.getClientRects().length) continue;
      n++;
      const name = (el.textContent || '').trim().slice(0, 30);
      if (el.scrollWidth > el.clientWidth + 1) {
        // An ellipsized single-line element (list name cell, crumbs) clips on purpose: its box is inside the container, which is what matters.
        const ts = getComputedStyle(el).textOverflow;
        if (ts !== 'ellipsis') out.push(`${el.className} "${name}": scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      }
      // The element's content (range over its text) must sit inside the nearest card/cell/row/embed box.
      const box = el.closest('.shelf-sdk__card, td, .shelf-sdk__folder-tree-row, .shelf-sdk__breadcrumbs, .shelf-sdk__doc-header') || sdk;
      const bb = box.getBoundingClientRect();
      const rng = document.createRange(); rng.selectNodeContents(el);
      const tb = rng.getBoundingClientRect();
      const ts = getComputedStyle(el).textOverflow;
      if (tb.width && ts !== 'ellipsis' && (tb.right > bb.right + 1 || tb.right > sb.right + 1)) out.push(`${el.className} "${name}": text right ${Math.round(tb.right)} beyond container right ${Math.round(Math.min(bb.right, sb.right))}`);
    }
    return { out, n };
  }, NAME);
  if (!r.n) { failures++; console.log(`FAIL ${label}: found no name elements`); return; }
  if (r.out.length) { failures++; console.log(`FAIL ${label}:\n  ${r.out.join('\n  ')}`); } else console.log(`ok   ${label} (${r.n} name elements)`);
}

try {
  for (const width of [1280, 900, 375]) for (const hostile of [0, 1]) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    const sfx = `${width}${hostile ? '-hostile' : ''}`;
    await page.goto(`${base}/?hostile=${hostile}&api=/api/shelflong`);
    await page.waitForSelector('.shelf-sdk__file-card');
    await page.evaluate(() => document.fonts.ready);
    const snap = async (v) => { if (shots) writeFileSync(`${shots}/wrap-${v}-${sfx}.png`, await page.screenshot({ fullPage: true })); };
    await check(page, `gallery ${sfx}`); await snap('gallery');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.waitForSelector('.shelf-sdk__item-name-text');
    await check(page, `list ${sfx}`); await snap('list');
    await page.getByRole('button', { name: 'Gallery', exact: true }).click();
    // Open the sub-folder with the spaced name: crumbs now carry two long names.
    await page.locator('.shelf-sdk__folder-tile-main', { hasText: 'Quarterly review' }).first().click();
    await page.waitForSelector('.shelf-sdk__breadcrumb[aria-current="page"]');
    await check(page, `subfolder crumbs ${sfx}`); await snap('crumbs');
    await page.locator('.shelf-sdk__breadcrumbs li').first().locator('button, a').first().click();
    await page.waitForSelector('.shelf-sdk__file-card');
    await page.locator('.shelf-sdk__file-card-link', { hasText: 'Stellenbosch_Wedding' }).first().dispatchEvent('click');
    await page.waitForSelector('.shelf-sdk__doc-title');
    await check(page, `document ${sfx}`); await snap('document');
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(failures ? `wrap: ${failures} failing view(s)` : 'wrap: all views pass');
process.exit(failures ? 1 : 0);
