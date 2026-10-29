// Renders the built SDK in Chromium and saves the evidence screenshots. Usage: node shoot.mjs <outDir> [<outDir>...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from './png.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDirs = process.argv.slice(2);
for (const d of outDirs) mkdirSync(d, { recursive: true });
const PORT = 4173, base = `http://localhost:${PORT}`;
const srv = spawn('node', [here + 'serve.mjs'], { env: { ...process.env, PORT }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const save = async (page, name) => { const buf = await page.screenshot({ fullPage: false }); for (const d of outDirs) writeFileSync(`${d}/${name}.png`, buf); return buf; };
const results = {};
try {
  for (const width of [1280, 900]) {
    for (const mode of ['flow', 'abs']) for (const hostile of [0, 1]) {
      const ctx = await browser.newContext({ viewport: { width, height: 560 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error('pageerror', e.message));
      const sfx = `${width}${hostile ? '-hostile' : ''}`; const keep = mode === 'flow';
      await page.goto(`${base}/?hostile=${hostile}${keep ? '' : '&abs=1'}`);
      await page.waitForSelector('.shelf-sdk__folder-tile');
      await page.evaluate(() => document.fonts.ready);
      const shots = {};
      const go = async (name) => { if (keep) await save(page, `${name}-${sfx}`); };
      // Hide the host heading chrome only for the isolation diff: compare the component element alone.
      // The pointer is parked away from the cards first so a hover transition cannot be caught half-way (it made this diff flaky).
      const comp = async (name) => { if (keep) return; await page.mouse.move(0, 0); await page.waitForTimeout(450); const el = page.locator('.shelf-sdk').first(); const b = await el.screenshot(); shots[name + ':component'] = b; if (!keep) writeFileSync(here + `out/comp-${name}-${sfx}.png`, b); };
      await go('root-gallery'); await comp('root-gallery');
      await page.getByRole('button', { name: 'List' }).click(); await go('root-list'); await comp('root-list');
      await page.getByRole('button', { name: 'Gallery' }).click();
      await page.getByRole('button', { name: /Contracts/ }).first().click();
      await page.waitForSelector('.shelf-sdk__file-card');
      await go('contracts-gallery'); await comp('contracts-gallery');
      await page.getByRole('button', { name: 'List' }).click(); await go('contracts-list'); await comp('contracts-list');
      await page.getByRole('button', { name: /contract-draft/ }).first().click();
      await page.waitForTimeout(600); await go('document-detail'); await comp('document-detail');
      if (!keep) results[sfx] = shots;
      await ctx.close();
    }
  }
  {
    // Target-equivalent: the reference screenshot is 2000 px wide, which matches a 1250 px viewport at DPR 1.6 (4 folder columns).
    const ctx = await browser.newContext({ viewport: { width: 1250, height: 594 }, deviceScaleFactor: 1.6 });
    const page = await ctx.newPage();
    await page.goto(`${base}/?bare=1`);
    await page.waitForSelector('.shelf-sdk__folder-tile');
    await page.evaluate(() => document.fonts.ready);
    await save(page, 'target-equivalent-root-gallery');
    await ctx.close();
  }
  // Isolation 1: component pixels with and without hostile host CSS.
  for (const w of [1280, 900]) {
    for (const k of Object.keys(results[w])) {
      if (!k.endsWith(':component')) continue;
      const d = PNG.diff(results[w][k], results[`${w}-hostile`][k]);
      console.log(`isolation ${w} ${k}: ${d.diffPixels} differing pixels of ${d.total}${d.sizeMismatch ? ' (SIZE MISMATCH ' + d.sizeMismatch + ')' : ''}`);
    }
  }
  // Isolation 2: the host's own elements are unchanged by loading the SDK (CSS + component).
  const probe = async (sdk, hostile) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/?hostile=${hostile}&sdk=${sdk}`);
    if (sdk) await page.waitForSelector('.shelf-sdk__folder-tile');
    const r = await page.evaluate(() => {
      const props = ['font-family', 'font-size', 'font-weight', 'color', 'margin-top', 'margin-bottom', 'border-bottom-width', 'line-height', 'letter-spacing', 'box-sizing', 'padding-top', 'background-color'];
      const o = {};
      for (const id of ['host-h1', 'host-p', 'host-btn', 'host-h2']) { const cs = getComputedStyle(document.getElementById(id)); o[id] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])); }
      return o;
    });
    await ctx.close();
    return r;
  };
  for (const hostile of [0, 1]) {
    const a = JSON.stringify(await probe(0, hostile)), b = JSON.stringify(await probe(1, hostile));
    console.log(`host elements unchanged by SDK (hostile=${hostile}): ${a === b}`);
    if (a !== b) { console.log(a); console.log(b); }
  }
} finally { await browser.close(); srv.kill(); }
