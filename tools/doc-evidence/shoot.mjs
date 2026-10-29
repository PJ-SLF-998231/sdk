// Screenshots of the document page at 1280px into docs/screenshots/doc-*.png.
// Usage: PLAYWRIGHT_DIR=/path/to/node_modules/playwright node tools/doc-evidence/shoot.mjs
// (needs `npm run build` and `node tools/doc-evidence/build.mjs` first). Dev tooling only; not published.
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
const PORT = 4181;
const server = spawn('node', [join(here, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const base = `http://localhost:${PORT}`;
const browser = await chromium.launch({ args: ['--headless=new'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const shot = async (name, doc, tab, wait) => {
    await page.goto(`${base}/?doc=${doc}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (tab) await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(wait ?? 600);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `doc-${name}-1280.png`) });
    console.log('wrote', `doc-${name}-1280.png`, 'tabs:', JSON.stringify(await page.getByRole('tab').allTextContents()));
  };
  await shot('text', 'd1', null); // a PDF with no site: Text | Preview only (the Content tab is absent)
  await shot('preview', 'd1', 'Preview', 3500);
  await shot('content', 'd2', 'Content', 800); // a document with a site: Text | Preview | Content
} finally {
  await browser.close();
  server.kill();
}
