// P3: render the same long names in Shelf web itself (its Vite dev server, api mocked with Playwright route
// interception: no real login, no network beyond localhost) and in the SDK, then save side-by-side screenshots and a
// table of computed-style differences. No Docker. Needs a Shelf web checkout (SHELF_WEB, default ../../shelf/web)
// with node_modules installed; it is only read.
// Usage: node shelf-compare.mjs [outDir]   (default ../docs/screenshots)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LDOCS, LONG_FOLDER_UNBROKEN, LONG_FOLDER_SPACED, COMPARE_NAME } from './fake-api.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.argv[2] ?? here + '../docs/screenshots';
mkdirSync(out, { recursive: true });
const WEB = process.env.SHELF_WEB ?? here + '../../shelf/web';
const WPORT = 5391, SPORT = 4177;

// ---- Shelf web's mocked api ----
const SHELF = 'aaaaaaaa-0000-4000-8000-000000000001';
const FID = (n) => `bbbbbbbb-0000-4000-8000-00000000000${n}`;
const folder = (n, name, parent = null) => ({ id: FID(n), shelf_id: SHELF, parent_id: parent, name, created_at: '2026-10-01T09:00:00Z', item_count: 0, total_item_count: 0 });
const FOLDERS = [folder(1, LONG_FOLDER_UNBROKEN), folder(2, LONG_FOLDER_SPACED)];
const file = (n, filename, folder_id = null) => ({
  id: `cccccccc-0000-4000-8000-00000000000${n}`, filename, content_type: 'application/pdf', size_bytes: 1500000 + n, shelf_id: SHELF, folder_id,
  vision_labels: null, vision_text: null, created_at: '2026-10-01T09:00:00Z', parse_status: 'parsed', parsed_text: 'x', parse_result: null, parse_error: null,
});
const FILES = LDOCS.map((d, i) => file(i + 1, d.filename)).map((f, i) => ({ ...f, content_type: LDOCS[i].content_type }));
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function mockShelf(page) {
  await page.route(/\/(api|auth)\//, (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (p === '/auth/me') return json(route, { sub: 'u1', email: 'e2e@example.com', name: 'E2E', picture: '' });
    if (p === '/api/v1/features') return json(route, {});
    if (p === '/api/v1/shelves') return json(route, [{ id: SHELF, name: LONG_FOLDER_UNBROKEN, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z', item_count: 5, folder_count: 3 }]);
    if (p === `/api/v1/shelves/${SHELF}`) return json(route, { id: SHELF, name: LONG_FOLDER_UNBROKEN, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z', item_count: 5, folder_count: 3 });
    if (p === `/api/v1/shelves/${SHELF}/folders`) return json(route, FOLDERS);
    if (p === `/api/v1/shelves/${SHELF}/files`) {
      const f = u.searchParams.get('folder_id');
      return json(route, { files: !f || f === 'root' ? FILES : [], next_cursor: null });
    }
    return json(route, {}, 404);
  });
}

const procs = [];
const start = (cmd, args, opts) => { const c = spawn(cmd, args, { stdio: 'ignore', ...opts }); procs.push(c); return c; };
async function waitHttp(url) { for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 300)); } throw new Error('no server at ' + url); }

const PROPS = ['display', 'white-space', 'overflow-wrap', 'word-break', 'text-overflow', 'overflow', 'min-width', '-webkit-line-clamp'];
const rows = [];
const styles = (page, sel, text) => page.evaluate(([sel, props, text]) => {
  const el = [...document.querySelectorAll(sel)].find((e) => !text || (e.textContent || '').trim() === text); if (!el) return null;
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { ...Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])), width: Math.round(r.width), height: Math.round(r.height), lines: Math.round(r.height / parseFloat(cs.lineHeight || '20')) };
}, [sel, PROPS, text]);

try {
  start('npx', ['vite', '--host', '127.0.0.1', '--port', String(WPORT), '--strictPort'], { cwd: WEB, env: { ...process.env, API_PROXY_TARGET: 'http://127.0.0.1:9', VITE_FLAGS: '' } });
  start('node', [here + 'serve.mjs'], { env: { ...process.env, PORT: SPORT } });
  await waitHttp(`http://127.0.0.1:${WPORT}/`); await waitHttp(`http://localhost:${SPORT}/`);
  const browser = await chromium.launch();
  const T = { 'card title': COMPARE_NAME, 'card title link': COMPARE_NAME, 'folder tile name': LONG_FOLDER_SPACED };
  const pairs = [
    ['card title', '.shelf-sdk__file-card-name', '.file-grid .file-card-name'],
    ['card title link', '.shelf-sdk__file-card-link', '.file-grid .file-card-link'],
    ['folder tile name', '.shelf-sdk__folder-tile-name', '.folder-tile-name'],
    ['folder tile text', '.shelf-sdk__folder-tile-text', '.folder-tile-text'],
    ['folder tile main', '.shelf-sdk__folder-tile-main', '.folder-tile-main'],
  ];
  for (const width of [1280, 900, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 3000 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => localStorage.setItem('shelf-theme', 'light'));
    const web = await ctx.newPage(); await mockShelf(web);
    web.on('pageerror', (e) => console.error('web pageerror', e.message));
    await web.goto(`http://127.0.0.1:${WPORT}/shelves/${SHELF}`);
    await web.waitForSelector('.file-card-name'); await web.evaluate(() => document.fonts.ready);
    const sdk = await ctx.newPage();
    await sdk.goto(`http://localhost:${SPORT}/?hostile=0&api=/api/shelflong`); await sdk.waitForSelector('.shelf-sdk__file-card'); await sdk.evaluate(() => document.fonts.ready);
    const cols = (p, s) => p.evaluate((s) => new Set([...document.querySelectorAll(s)].map((e) => Math.round(e.getBoundingClientRect().top))).size && [...document.querySelectorAll(s)].filter((e) => Math.abs(e.getBoundingClientRect().top - document.querySelector(s).getBoundingClientRect().top) < 2).length, s);
    const gw = await web.locator('.file-grid').first().evaluate((e) => e.getBoundingClientRect().width);
    await sdk.evaluate((w) => { document.getElementById('root').style.width = w + 'px'; }, gw); await sdk.waitForTimeout(600);
    // The embed's own padding differs from the Shelf page's at narrow widths: widen the host box until the grids are the same width.
    const sg = await sdk.locator('.shelf-sdk__file-grid').first().evaluate((e) => e.getBoundingClientRect().width);
    if (Math.abs(sg - gw) > 0.5) { await sdk.evaluate((w) => { document.getElementById('root').style.width = w + 'px'; }, gw + (gw - sg)); await sdk.waitForTimeout(600); }
    const webGrid = await web.locator('.file-grid').first(), sdkGrid = await sdk.locator('.shelf-sdk__file-grid').first();
    for (const [what, s, w] of pairs) rows.push({ width, what, sdk: await styles(sdk, s, T[what]), web: await styles(web, w, T[what]) });
    rows.push({ width, what: 'cards in the first row', sdk: await cols(sdk, '.shelf-sdk__file-card'), web: await cols(web, '.file-grid .file-card') });
    const wb = await webGrid.boundingBox(), sb = await sdkGrid.boundingBox();
    rows.push({ width, what: 'file grid size', sdk: `${Math.round(sb.width)}x${Math.round(sb.height)}`, web: `${Math.round(wb.width)}x${Math.round(wb.height)}` });
    // Composite: both grids side by side (labelled), as one image.
    const a = (await webGrid.screenshot()).toString('base64'), b = (await sdkGrid.screenshot()).toString('base64');
    const cmp = await ctx.newPage(); await cmp.setViewportSize({ width: Math.max(width, 400), height: 400 });
    await cmp.setContent(`<body style="margin:0;font:14px sans-serif;background:#fff"><div style="display:flex;gap:16px;flex-direction:${width <= 900 ? 'column' : 'row'};padding:8px">
      <div><b>Shelf web (.file-grid)</b><br><img src="data:image/png;base64,${a}"></div><div><b>SDK (.shelf-sdk__file-grid)</b><br><img src="data:image/png;base64,${b}"></div></div></body>`);
    writeFileSync(`${out}/wrap-compare-gallery-${width}.png`, await cmp.screenshot({ fullPage: true }));
    // Crumbs: a sub-folder holding the long name, in Shelf (?folder=) and the SDK (click the tile).
    await web.goto(`http://127.0.0.1:${WPORT}/shelves/${SHELF}?folder=${FID(2)}`);
    await web.waitForSelector('.breadcrumbs'); await web.evaluate(() => document.fonts.ready);
    await sdk.locator('.shelf-sdk__folder-tile-main', { hasText: 'Quarterly review' }).first().click();
    await sdk.waitForSelector('.shelf-sdk__breadcrumb[aria-current="page"]');
    const crumbs = [['breadcrumbs', '.shelf-sdk__breadcrumbs', '.shelf-crumbs-row .breadcrumbs'], ['breadcrumb (current)', '.shelf-sdk__breadcrumb[aria-current="page"]', '.breadcrumb[aria-current="page"]'], ['breadcrumb li', '.shelf-sdk__breadcrumbs li', '.shelf-crumbs-row .breadcrumbs li']];
    for (const [what, s, w] of crumbs) rows.push({ width, what: 'crumbs: ' + what, sdk: await styles(sdk, s), web: await styles(web, w) });
    const wc = (await web.locator('.shelf-crumbs-row').first().screenshot()).toString('base64'), sc = (await sdk.locator('.shelf-sdk__breadcrumbs').first().screenshot()).toString('base64');
    await cmp.setContent(`<body style="margin:0;font:14px sans-serif;background:#fff;padding:8px"><b>Shelf web (.shelf-crumbs-row)</b><br><img src="data:image/png;base64,${wc}"><br><br><b>SDK (.shelf-sdk__breadcrumbs)</b><br><img src="data:image/png;base64,${sc}"></body>`);
    writeFileSync(`${out}/wrap-compare-crumbs-${width}.png`, await cmp.screenshot({ fullPage: true }));
    await ctx.close();
  }
  await browser.close();
} finally { for (const p of procs) p.kill(); }

// ---- the difference table ----
const show = (v) => (v && typeof v === 'object' ? PROPS.concat(['width', 'height', 'lines']).map((k) => `${k}=${v[k]}`).join(' ') : String(v));
const lines = [];
for (const r of rows) {
  if (r.sdk && typeof r.sdk === 'object' && r.web && typeof r.web === 'object') {
    const diff = Object.keys(r.sdk).filter((k) => r.sdk[k] !== r.web[k]);
    lines.push(`${r.width}  ${r.what}: ${diff.length ? 'DIFF ' + diff.map((k) => `${k}: shelf=${r.web[k]} sdk=${r.sdk[k]}`).join('; ') : 'identical'}`);
  } else lines.push(`${r.width}  ${r.what}: shelf=${show(r.web)} sdk=${show(r.sdk)}`);
}
console.log(lines.join('\n'));
writeFileSync(`${out}/wrap-compare.txt`, lines.join('\n') + '\n');
