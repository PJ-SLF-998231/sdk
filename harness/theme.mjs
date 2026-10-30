// Hostile-host theme test. Usage: node theme.mjs   (needs `npm run build` in the repo root and `node build.mjs` here)
// The host page is light-only (the harness page paints no dark styles); the visitor's OS is dark. The embed must stay light
// unless the host asks for theme="dark" or theme="auto". Exits 1 on any failed expectation.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.THEME_PORT || 4175), base = `http://localhost:${PORT}`;
const srv = spawn('node', [here + 'serve.mjs'], { env: { ...process.env, PORT }, stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 800));
const LIGHT_BG = 'rgb(255, 255, 255)', DARK_BG = 'rgb(18, 18, 16)'; // --bg in light and dark tokens
const cases = [
  // [query, OS scheme, expected data-theme attribute, expected background]
  ['', 'dark', 'light', 'light'],
  ['', 'light', 'light', 'light'],
  ['theme=light', 'dark', 'light', 'light'],
  ['theme=dark', 'light', 'dark', 'dark'],
  ['theme=dark', 'dark', 'dark', 'dark'],
  ['theme=auto', 'dark', 'auto', 'dark'],
  ['theme=auto', 'light', 'auto', 'light'],
];
const browser = await chromium.launch();
let failed = 0;
try {
  for (const hostile of [0, 1]) for (const [q, os, attr, want] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, colorScheme: os });
    const page = await ctx.newPage();
    await page.emulateMedia({ colorScheme: os });
    await page.goto(`${base}/?bare=1&hostile=${hostile}${q ? '&' + q : ''}`);
    await page.waitForSelector('.shelf-sdk__folder-tile');
    const r = await page.evaluate(() => {
      const el = document.querySelector('.shelf-sdk');
      const cs = getComputedStyle(el);
      return { attr: el.getAttribute('data-theme'), bg: cs.backgroundColor, fg: cs.color, scheme: cs.colorScheme };
    });
    const bg = want === 'light' ? LIGHT_BG : DARK_BG;
    const ok = r.attr === attr && r.bg === bg && r.scheme === want;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} host=${hostile ? 'hostile' : 'plain'} os=${os} ${q || '(no theme prop)'} -> data-theme=${r.attr} bg=${r.bg} color-scheme=${r.scheme} (want ${attr}, ${bg}, ${want})`);
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(failed ? `${failed} theme expectation(s) failed` : 'all theme expectations hold');
process.exit(failed ? 1 : 0);
