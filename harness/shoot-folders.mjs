// Folder write UI of a read_write key, in Chromium. Usage: node shoot-folders.mjs [outDir]  (default ../docs/screenshots)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.argv[2] || here + '../docs/screenshots';
mkdirSync(out, { recursive: true });
const PORT = 4174, base = `http://localhost:${PORT}`;
const srv = spawn('node', [here + 'serve.mjs'], { env: { ...process.env, PORT }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 560 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await fetch(`${base}/__harness/folders-reset`);
  await page.goto(`${base}/?cacheScope=shoot-folders`);
  await page.waitForSelector('.shelf-sdk__folder-tile');
  await page.evaluate(() => document.fonts.ready);
  const shot = async (name) => { await page.mouse.move(0, 0); await page.waitForTimeout(450); writeFileSync(`${out}/folders-${name}.png`, await page.screenshot()); console.log('saved', `folders-${name}.png`); };

  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByLabel('New folder name').fill('Receipts');
  await shot('new-folder-form');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Actions for folder Quotes' }).click();
  await shot('card-menu');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Contracts/ }).first().click();
  await page.waitForSelector('.shelf-sdk__file-card');
  await page.getByRole('button', { name: 'Actions for folder Contracts' }).click();
  await shot('header-menu');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').waitFor();
  await shot('delete-confirm');
} finally { await browser.close(); srv.kill(); }
