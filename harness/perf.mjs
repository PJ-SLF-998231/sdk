// Performance evidence for the folder view. Usage: node perf.mjs [--runs 5] [--json]
// Needs `npm run build` in the repo root and `npm install` in this folder (Playwright, harness-only).
// Prints warmFirstPaintMs (median of --runs, API delayed 300 ms so the data can only come from the IndexedDB cache),
// coldFirstPaintMs, maxCardsInDom, longTasksOver50ms, p95FrameMs and cls for a full scroll through 5000 documents,
// and a read_write offline run (rename, upload, delete while offline; each must reach the server exactly once).
// Exits 1 when a target is missed. The measurement is never weakened to pass: a miss prints its number.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const RUNS = Number(args.includes('--runs') ? args[args.indexOf('--runs') + 1] : 5);
const PORT = Number(process.env.PERF_PORT || 4174), base = `http://localhost:${PORT}`;
const API = '/api/shelf5k';
const TARGETS = { warmFirstPaintMs: 100, maxCardsInDom: 150, longTasksOver50ms: 0, p95FrameMs: 20, cls: 0.01 };

const srv = spawn('node', [here + 'serve.mjs'], { env: { ...process.env, PORT }, stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 800));
const ctl = (path) => fetch(base + path).then((r) => r.json());
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const url = (scope) => `${base}/?api=${API}&bare=1${scope ? `&cacheScope=${scope}` : ''}`;
const CARD = '.shelf-sdk__file-card';

// Runs before any page script: first-card detection, long tasks, layout shifts.
const INIT = () => {
  const P = (window.__perf = { firstCardAt: null, firstPaintAt: null, cardsAtFirstPaint: 0, long: [], shifts: [], t0: null });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) P.shifts.push({ start: e.startTime, value: e.value }); }).observe({ type: 'layout-shift', buffered: true });
  const mo = new MutationObserver(() => {
    if (P.firstCardAt !== null || !document.querySelector('.shelf-sdk__file-card')) return;
    P.firstCardAt = performance.now();
    mo.disconnect();
    // Double rAF: the first callback runs before the frame that contains the cards, the second after it was presented.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      P.firstPaintAt = performance.now();
      P.cardsAtFirstPaint = document.querySelectorAll('.shelf-sdk__file-card').length;
    }));
  });
  mo.observe(document, { childList: true, subtree: true });
};

async function firstPaint(page) {
  await page.waitForFunction(() => window.__perf?.firstPaintAt !== null && window.__perf?.firstPaintAt !== undefined, null, { timeout: 30000 });
  return page.evaluate(() => {
    const mount = performance.getEntriesByName('sdk-mount')[0]?.startTime ?? 0;
    const P = window.__perf;
    return { ms: P.firstPaintAt - mount, cards: P.cardsAtFirstPaint };
  });
}

const browser = await chromium.launch();
const out = { runs: RUNS };
let failed = false;
try {
  // ---- warm: cache filled by a first visit, then reloads with the API delayed 300 ms ----
  console.error('stage: warm: cache filled by a first ');
  await ctl('/__harness/reset');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(url('perf-warm'));
    await page.waitForSelector(CARD);
    await page.waitForTimeout(2500); // let the write-behind cache and the thumbnails settle
    await ctl('/__harness/delay?ms=300');
    const warm = [], cards = [];
    for (let i = 0; i < RUNS; i++) {
      await page.goto(url('perf-warm'));
      const r = await firstPaint(page);
      warm.push(r.ms); cards.push(r.cards);
      await page.waitForTimeout(700); // the delayed revalidation finishes before the next load
    }
    out.warmRuns = warm.map((x) => +x.toFixed(1));
    out.warmFirstPaintMs = +median(warm).toFixed(1);
    out.warmCardsAtFirstPaint = median(cards);
    await ctl('/__harness/delay?ms=0');
    await ctx.close();
  }
  // ---- cold: a fresh browser context each time, nothing cached ----
  console.error('stage: cold: a fresh browser context ');
  {
    const cold = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(INIT);
      const page = await ctx.newPage();
      await page.goto(url(`perf-cold-${i}`));
      cold.push((await firstPaint(page)).ms);
      await ctx.close();
    }
    out.coldRuns = cold.map((x) => +x.toFixed(1));
    out.coldFirstPaintMs = +median(cold).toFixed(1);
  }
  // ---- full scroll through all 5000 documents (gallery, then list) ----
  console.error('stage: full scroll through all 5000 d');
  for (const layout of ['gallery', 'list']) {
    await ctl('/__harness/reset');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(url(`perf-scroll-${layout}`));
    await page.waitForSelector(CARD);
    if (layout === 'list') { await page.getByRole('button', { name: 'List' }).click(); await page.waitForSelector('.shelf-sdk__item-row'); }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    const sel = layout === 'gallery' ? CARD : '.shelf-sdk__item-row';
    const res = await page.evaluate(({ sel }) => new Promise((resolve) => {
      const P = window.__perf;
      const t0 = performance.now();
      const frames = [];
      let last = performance.now(), maxCards = 0, atBottomSince = null, lastY = -1;
      const tick = (now) => {
        frames.push(now - last); last = now;
        maxCards = Math.max(maxCards, document.querySelectorAll(sel).length);
        window.scrollBy(0, 40); // ~2400 px/s at 60 Hz: a brisk flick, continuous
        const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        if (bottom && window.scrollY === lastY) { atBottomSince ??= now; } else atBottomSince = null;
        lastY = window.scrollY;
        // Done once parked at the very bottom for 1.5 s: any further pages have had time to arrive.
        if (atBottomSince !== null && now - atBottomSince > 1500) {
          const t1 = performance.now();
          return resolve({ frames: frames.slice(1), maxCards, t0, t1, scrollHeight: document.documentElement.scrollHeight, longs: P.long.filter((l) => l.start >= t0 && l.start <= t1), shiftsTotal: P.shifts.reduce((a, s) => a + s.value, 0) });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), { sel });
    const stats = await ctl('/__harness/stats');
    const moving = res.frames.slice(0, -90); // drop the parked tail
    const r = {
      layout,
      pagesFetched: stats.files,
      frames: moving.length,
      maxCardsInDom: res.maxCards,
      longTasksOver50ms: res.longs.filter((l) => l.dur > 50).length,
      longTaskMaxMs: +Math.max(0, ...res.longs.map((l) => l.dur)).toFixed(1),
      p50FrameMs: +pct(moving, 0.5).toFixed(1),
      p95FrameMs: +pct(moving, 0.95).toFixed(1),
      maxFrameMs: +Math.max(...moving).toFixed(1),
      cls: +res.shiftsTotal.toFixed(4),
      scrollHeight: res.scrollHeight,
    };
    out[layout] = r;
    await ctx.close();
  }
  // ---- read_write offline: rename, upload, delete while offline; come online; each drains exactly once ----
  console.error('stage: read_write offline: rename, up');
  {
    await ctl('/__harness/reset');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(url('perf-offline'));
    await page.waitForSelector(CARD);
    await page.waitForTimeout(1200);
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const card = (n) => page.locator(CARD).filter({ hasText: n }).first();
    // rename doc-0001.png
    await page.getByRole('button', { name: 'Actions for doc-0001.png' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('New name').fill('renamed-offline.png');
    await page.getByRole('button', { name: 'Save name' }).click();
    // delete doc-0002.png
    await page.getByRole('button', { name: 'Actions for doc-0002.png' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();
    // upload
    await page.getByLabel('Upload files').setInputFiles({ name: 'offline-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForSelector('text=/\\d+ changes? will be sent/', { timeout: 5000 });
    await page.waitForTimeout(500);
    const bannerOffline = await page.locator('[data-testid="shelf-outbox-banner"]').innerText();
    const during = await ctl('/__harness/stats');
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.querySelector('[data-testid="shelf-outbox-banner"]'), null, { timeout: 20000 });
    await page.waitForTimeout(1500); // anything that would drain twice would have by now
    const after = await ctl('/__harness/stats');
    out.offline = {
      bannerWhileOffline: bannerOffline,
      requestsWhileOffline: { patch: during.patch, post: during.post, delete: during.delete },
      afterOnline: { patch: after.patch, post: after.post, delete: after.delete },
      queuedChangesShown: Number(/(\d+) change/.exec(bannerOffline)?.[1] ?? 0),
      drainedExactlyOnce: during.patch + during.post + during.delete === 0 && after.patch === 1 && after.post === 1 && after.delete === 1,
    };
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }

const g = out.gallery, l = out.list;
const lines = {
  warmFirstPaintMs: out.warmFirstPaintMs, warmRuns: out.warmRuns.join(' '), warmCardsAtFirstPaint: out.warmCardsAtFirstPaint,
  coldFirstPaintMs: out.coldFirstPaintMs, coldRuns: out.coldRuns.join(' '),
  maxCardsInDom: g.maxCardsInDom, longTasksOver50ms: g.longTasksOver50ms, p95FrameMs: g.p95FrameMs, cls: g.cls,
};
if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  for (const [k, v] of Object.entries(lines)) console.log(`${k}: ${v}`);
  console.log('gallery scroll:', JSON.stringify(g));
  console.log('list scroll:', JSON.stringify(l));
  console.log('offline:', JSON.stringify(out.offline));
}
// Gate: warm first paint, the gallery scroll and the offline run decide the exit status (the gallery is the default view
// and the one the card budget is about). The list view is measured the same way and printed; its misses gate only
// with --strict, and are never hidden: they print as "list MISSED".
const STRICT = args.includes('--strict');
const check = (name, r) => {
  const m = [];
  if (!(r.maxCardsInDom <= TARGETS.maxCardsInDom)) m.push(`${name}.maxCardsInDom=${r.maxCardsInDom}`);
  if (r.longTasksOver50ms !== TARGETS.longTasksOver50ms) m.push(`${name}.longTasksOver50ms=${r.longTasksOver50ms}`);
  if (!(r.p95FrameMs <= TARGETS.p95FrameMs)) m.push(`${name}.p95FrameMs=${r.p95FrameMs}`);
  if (!(r.cls < TARGETS.cls)) m.push(`${name}.cls=${r.cls}`);
  if (r.pagesFetched < 25) m.push(`${name}.pagesFetched=${r.pagesFetched}<25`);
  return m;
};
const miss = [];
if (!(out.warmFirstPaintMs < TARGETS.warmFirstPaintMs)) miss.push(`warmFirstPaintMs=${out.warmFirstPaintMs}`);
miss.push(...check('gallery', g));
if (!out.offline.drainedExactlyOnce) miss.push('offline.drainedExactlyOnce');
const listMiss = check('list', l);
if (listMiss.length) console.log(`list MISSED${STRICT ? '' : ' (not gating without --strict)'}: ${listMiss.join(', ')}`);
if (STRICT) miss.push(...listMiss);
console.log(miss.length ? `TARGETS MISSED: ${miss.join(', ')}` : 'all gating targets met');
process.exit(miss.length ? 1 : 0);
