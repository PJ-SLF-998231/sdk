// Standalone-CSS proof (0.4 U9-A). Usage (after `npm run build` in the repo root):
//   node harness/parts.mjs [--shots docs/screenshots/parts]
// Needs plain `playwright` (harness/node_modules, or PLAYWRIGHT_DIR=/path/to/node_modules/playwright) and esbuild.
// For every standalone component it renders the component ALONE (no ShelfProvider/ShelfFolder), under a plain and a hostile
// host page, and compares what the browser computes:
//   1. computed-style dumps (every property of every element and its ::before/::after) equal across four stylesheet setups:
//        styles.css alone | the part's own css/<entry>.css alone | every part css forward | every part css reverse
//   2. combinations of parts, each with only its own parts' CSS, forward and reverse, equal to styles.css alone
//   3. per part: pixels of own-CSS-alone under the hostile host vs the plain host differ by <= 2
//   4. a light host whose OS prefers dark keeps every standalone part light
//   5. the host's own elements are unchanged by loading the part's CSS and rendering it
// Exits 1 on any failure.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { entries } from '../scripts/entries.mjs';
import { handle } from './fake-api.mjs';
import { PNG } from './png.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
mkdirSync(join(here, 'out'), { recursive: true });
await build({
  entryPoints: [join(here, 'parts.tsx')], outfile: join(here, 'out/parts.js'), bundle: true, format: 'esm', jsx: 'automatic',
  logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [join(repo, 'node_modules')],
});

// part -> the entry whose stylesheet it ships in
const ALL_PARTS = [
  ['FolderCard', 'folder-card'], ['FolderNameForm', 'folder-card'], ['FolderGrid', 'folder-grid'], ['FolderHeader', 'folder-header'],
  ['FolderToolbar', 'folder-toolbar'], ['ViewToggle', 'view-toggle'], ['UploadDropzone', 'upload-dropzone'], ['DocumentCard', 'document-card'],
  ['DocumentGallery', 'document-gallery'], ['DocumentList', 'document-list'], ['DocumentTextTab', 'document-page'],
  ['DocumentPreviewTab', 'document-page'], ['DocumentPage', 'document-page'], ['OfflineBanner', 'offline-banner'], ['ActionMenu', 'action-menu'],
  ['FolderTree', 'folder-tree'], ['ShelfFolder', 'folder-view'],
];
const PARTS = process.env.PARTS_ONLY ? ALL_PARTS.filter(([n]) => process.env.PARTS_ONLY.split(',').includes(n)) : ALL_PARTS;
const entryOf = Object.fromEntries(ALL_PARTS);
const COMBOS = [
  ['FolderHeader', 'FolderToolbar', 'FolderGrid', 'DocumentGallery'],
  ['DocumentCard', 'ActionMenu', 'OfflineBanner', 'FolderCard'],
  ['FolderTree', 'ViewToggle', 'UploadDropzone', 'DocumentList', 'DocumentTextTab'],
  ['FolderCard', 'DocumentCard', 'FolderGrid', 'DocumentList'],
];
// every component entry that has css and renders UI, in entries.mjs order
const uiEntries = entries.filter((e) => e.css && !['hooks', 'provider'].some((n) => e.out === `react/${n}/index`)).map((e) => e.css.file.replace(/^css\//, '').replace(/\.css$/, ''));
const cssOf = (name) => `dist/css/${name}.css`;
const ALL = uiEntries.map(cssOf);
const uniq = (a) => [...new Set(a)];

// ---- tiny server: the repo, the fake API, and /parts.html?part=A,B&css=a.css,b.css&host=plain|hostile|bare
const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };
const srv = createServer(async (req, res) => {
  if (handle(req, res)) return;
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/parts.html') {
    const q = u.searchParams, links = (q.get('css') || '').split(',').filter(Boolean).map((c) => `<link rel="stylesheet" href="/${c}">`).join('\n');
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>parts</title>
${q.get('host') === 'hostile' ? '<link rel="stylesheet" href="/harness/host.css">' : '<style>body{margin:0;padding:28px;font-family:sans-serif}</style>'}
${links}${q.get('bare') === '1' ? '<style>#host-h1,#host-p,#host-h2{display:none}</style>' : ''}</head><body><h1 id="host-h1">Host page heading</h1><p id="host-p">Host paragraph <a href="#">link</a> <button id="host-btn">Host button</button></p>
<div id="root" style="position:absolute;left:28px;right:28px;top:20px"></div><h2 id="host-h2">After the component</h2><script type="module" src="/harness/out/parts.js?${q.get('part')}"></script></body></html>`);
  }
  const file = normalize(join(repo, u.pathname));
  if (!file.startsWith(repo) || file.includes('node_modules/.')) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => srv.listen(4181, r));
const base = 'http://localhost:4181';

const READY = { DocumentPage: '.shelf-sdk__doc-text, .shelf-sdk__doc-original-text', ShelfFolder: '.shelf-sdk__folder-tile' };
const browser = await chromium.launch();
let failures = 0;
const fail = (m) => { failures++; console.log('FAIL ' + m); };

async function open(parts, css, host, { colorScheme = 'light', bare = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2, colorScheme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${base}/parts.html?part=${parts.join(',')}&css=${css.join(',')}&host=${host}${bare ? '&bare=1' : ''}`);
  for (const p of parts) await page.waitForSelector(`[data-part="${p}"] .shelf-sdk`, { timeout: 15000 });
  for (const p of parts) if (READY[p]) await page.waitForSelector(`[data-part="${p}"] ${READY[p].split(',')[0]}`, { timeout: 15000 }).catch(() => {});
  for (const p of parts) if (p === 'ActionMenu') await page.click(`[data-part="${p}"] .shelf-sdk__action-menu-button`);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(parts.includes('ShelfFolder') ? 1200 : 400);
  // The sync pill pulses (an infinite animation reduced motion does not stop): freeze every animation at its first frame so
  // computed values and pixels do not depend on when they were read.
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; }));
  return { page, ctx };
}

// Every computed property of every element under the parts (and their ::before/::after), keyed by DOM path.
const dumpFn = () => {
  const out = {};
  for (const sec of document.querySelectorAll('[data-part]')) {
    // Only what the SDK renders: the harness's own wrappers sit in the host's styles and are not under test.
    const all = [...sec.querySelectorAll('.shelf-sdk, .shelf-sdk *')];
    all.forEach((el, i) => {
      for (const pseudo of [null, '::before', '::after']) {
        if (pseudo && !(getComputedStyle(el, pseudo).content !== 'none' && getComputedStyle(el, pseudo).content !== 'normal')) continue;
        const cs = getComputedStyle(el, pseudo);
        const o = {};
        for (let k = 0; k < cs.length; k++) o[cs[k]] = cs.getPropertyValue(cs[k]);
        out[`${sec.getAttribute('data-part')}#${i}<${el.tagName.toLowerCase()}${pseudo ?? ''}>`] = o;
      }
    });
  }
  return out;
};
const diffDumps = (a, b) => {
  const bad = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[k] || !b[k]) { bad.push(`${k}: element missing in one setup`); continue; }
    for (const p of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) if (a[k][p] !== b[k][p]) bad.push(`${k} ${p}: ${a[k][p]} != ${b[k][p]}`);
  }
  return bad;
};
const dump = async (parts, css, host, opts) => { const { page, ctx } = await open(parts, css, host, opts); const d = await page.evaluate(dumpFn); await ctx.close(); return d; };

let totalProps = 0, totalElements = 0;
const equalAcross = async (label, parts, setups, host) => {
  const dumps = [];
  for (const [name, css] of setups) dumps.push([name, await dump(parts, css, host)]);
  const ref = dumps[0];
  totalElements += Object.keys(ref[1]).length;
  totalProps += Object.values(ref[1]).reduce((n, o) => n + Object.keys(o).length, 0);
  let line = '';
  for (const [name, d] of dumps.slice(1)) {
    const bad = diffDumps(ref[1], d);
    line += ` ${name}:${bad.length}`;
    if (bad.length) { fail(`${label} [${host}] ${ref[0]} vs ${name}: ${bad.length} differing properties, first: ${bad.slice(0, 4).join(' | ')}`); }
  }
  console.log(`computed-style ${label} [${host}] elements=${Object.keys(ref[1]).length} differing props vs ${ref[0]}:${line}`);
};

// 1 + 2: computed styles equal across setups
for (const host of process.env.PARTS_SKIP_DUMPS ? [] : ['plain', 'hostile']) {
  for (const [part, entry] of PARTS) {
    await equalAcross(part, [part], [['styles.css', ['dist/styles.css']], ['own', [cssOf(entry)]], ['all-forward', ALL], ['all-reverse', [...ALL].reverse()]], host);
  }
  for (const combo of COMBOS) {
    const own = uniq(combo.map((p) => cssOf(entryOf[p])));
    await equalAcross(`combo(${combo.join('+')})`, combo, [['styles.css', ['dist/styles.css']], ['own-forward', own], ['own-reverse', [...own].reverse()], ['all-forward', ALL], ['all-reverse', [...ALL].reverse()]], host);
  }
}
console.log(`computed-style total: ${totalElements} element dumps, ${totalProps} property values compared`);

// 3: hostile vs plain pixels, own CSS alone (+ screenshots of the hostile page)
for (const [part, entry] of PARTS) {
  const shots = {};
  for (const host of process.env.PARTS_SELF ? ['plain', 'plain'] : ['plain', 'hostile']) {
    // bare: the host's own heading/paragraph are hidden so they cannot show through a transparent component
    const { page, ctx } = await open([part], [cssOf(entry)], host, { bare: true });
    const el = page.locator(`[data-part="${part}"]`);
    const box = await el.boundingBox();
    // A whole-pixel clip with an 8 px margin of host background: the renderer's first pixel column at the very edge of a capture is
    // noisy (plain vs plain differs by ~25 px there), so no component pixel may sit on the capture's edge.
    shots[shots.plain ? 'hostile' : host] = await page.screenshot({ animations: 'disabled', clip: { x: Math.floor(box.x) - 8, y: Math.floor(box.y) - 8, width: Math.ceil(box.width) + 16, height: Math.ceil(box.height) + 16 } });
    if (process.env.PARTS_DEBUG) writeFileSync(`/tmp/parts-${part}-${host}.png`, shots[host]);
    if (host === 'hostile' && shotsDir) writeFileSync(`${shotsDir}/${part}.png`, await page.screenshot({ fullPage: false }));
    await ctx.close();
  }
  const d = PNG.diff(shots.plain, shots.hostile);
  console.log(`pixels ${part} (${cssOf(entry)} alone) hostile vs plain: ${d.diffPixels} differing of ${d.total}${d.sizeMismatch ? ' SIZE MISMATCH ' + d.sizeMismatch : ''}`);
  if (d.sizeMismatch || d.diffPixels > 2) {
    const bad = diffDumps(await dump([part], [cssOf(entry)], 'plain'), await dump([part], [cssOf(entry)], 'hostile')).filter((l) => !l.includes('<section') && !/<input>/.test(l)); // the hidden file input renders nothing
    fail(`pixels ${part}: ${d.diffPixels}; computed properties that differ between hosts: ${bad.length}, first: ${bad.slice(0, 6).join(' | ')}`);
  }
}

// 4: a light host on a dark OS keeps standalone parts light
for (const host of ['plain', 'hostile']) {
  let n = 0;
  for (const [part, entry] of PARTS) {
    const { page, ctx } = await open([part], [cssOf(entry)], host, { colorScheme: 'dark' });
    const r = await page.evaluate((p) => [...document.querySelectorAll(`[data-part="${p}"] .shelf-sdk`)].map((el) => { const cs = getComputedStyle(el); return [el.getAttribute('data-theme'), cs.backgroundColor, cs.colorScheme]; }), part);
    await ctx.close();
    for (const [attr, bg, scheme] of r) { n++; if (attr !== 'light' || bg !== 'rgb(255, 255, 255)' || scheme !== 'light') fail(`dark OS [${host}] ${part}: data-theme=${attr} bg=${bg} color-scheme=${scheme}`); }
  }
  console.log(`dark-OS check [${host}]: ${n} standalone roots across ${PARTS.length} parts stay light`);
}

// 5: the host's own elements are not touched by loading a part's CSS and rendering it
const props = ['font-family', 'font-size', 'font-weight', 'color', 'margin-top', 'margin-bottom', 'border-bottom-width', 'line-height', 'letter-spacing', 'box-sizing', 'padding-top', 'background-color'];
const hostProbe = async (parts, css, host) => {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/parts.html?part=${parts.join(',')}&css=${css.join(',')}&host=${host}`);
  if (parts.length) await page.waitForSelector(`[data-part] .shelf-sdk`);
  await page.waitForTimeout(200);
  const r = await page.evaluate((ps) => Object.fromEntries(['host-h1', 'host-p', 'host-btn', 'host-h2'].map((id) => { const cs = getComputedStyle(document.getElementById(id)); return [id, Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]))]; })), props);
  await ctx.close();
  return JSON.stringify(r);
};
let hostSame = true;
for (const host of ['plain', 'hostile']) {
  const without = await hostProbe([], [], host);
  for (const [part, entry] of PARTS) {
    const ok = (await hostProbe([part], [cssOf(entry)], host)) === without;
    if (!ok) { hostSame = false; fail(`host elements changed by ${cssOf(entry)} + ${part} [${host}]`); }
  }
  if (host === 'hostile') { const ok = (await hostProbe(['FolderCard', 'DocumentList'], ALL, host)) === without; if (!ok) { hostSame = false; fail('host elements changed by all part css'); } }
}
console.log(`host elements unchanged by SDK (every part's own css, both hosts): ${hostSame}`);

await browser.close();
srv.close();
console.log(failures ? `${failures} FAILURE(S)` : 'all standalone-css expectations hold');
process.exit(failures ? 1 : 0);
void readFileSync;
