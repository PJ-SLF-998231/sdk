// Post-build guard: react stays external, and the stylesheet can neither restyle the host nor be restyled by it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const fail = (m) => { console.error('check-dist: ' + m); process.exit(1); };
const walkJs = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? (e.name === 'fonts' ? [] : walkJs(p)) : /\.(js|cjs)$/.test(e.name) ? [p] : [];
});
const jsFiles = walkJs('dist');
if (jsFiles.length === 0) fail('no js files in dist');
for (const f of jsFiles) {
  const s = readFileSync(f, 'utf8');
  if (/__SECRET_INTERNALS|ReactCurrentDispatcher/.test(s)) fail(`${f} bundles react`);
}
// react is imported, never bundled: the React code (entries and the chunks they share) imports react/jsx-runtime externally.
for (const [ext, files] of [['js', jsFiles.filter((f) => f.endsWith('.js'))], ['cjs', jsFiles.filter((f) => f.endsWith('.cjs'))]]) {
  if (!files.some((f) => /["']react\/jsx-runtime["']/.test(readFileSync(f, 'utf8')))) fail(`no .${ext} file imports react/jsx-runtime externally`);
}

// One stylesheet: scoped to .shelf-sdk, prefixed classes, fonts resolve from where the file sits.
function checkCss(file, fontRel, minSelectors) {
const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
if (!css.includes('.shelf-sdk')) fail(`${file} is not scoped to .shelf-sdk`);
if (/@import/.test(css)) fail(`${file} has an @import (third-party requests are not allowed)`);

// Walk every rule. `selectors` collects the prelude of each style rule, at any @media/@supports depth.
const selectors = [];
const atRules = [];
(function walk(text) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    const semi = text.indexOf(';', i);
    if (open === -1 || (semi !== -1 && semi < open)) { if (semi === -1) break; atRules.push(text.slice(i, semi).trim()); i = semi + 1; continue; }
    const head = text.slice(i, open).trim();
    let depth = 1, k = open + 1, q = null;
    while (k < text.length && depth > 0) {
      const c = text[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    const body = text.slice(open + 1, k - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) walk(body);
    else if (head.startsWith('@')) atRules.push(head);
    else selectors.push(head);
    i = k;
  }
})(css);

const split = (s) => { const out = []; let d = 0, cur = ''; for (const c of s) { if ('([' .includes(c)) d++; if (')]'.includes(c)) d--; if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur.trim()); return out; };
let checked = 0;
for (const prelude of selectors) {
  for (const sel of split(prelude)) {
    checked++;
    if (!/^\.shelf-sdk(?![\w-])/.test(sel)) fail(`${file}: unscoped selector: ${sel}`);
    if (/(^|[\s>+~(,])(:root|html|body)(?![\w-])/.test(sel)) fail(`${file}: selector reaches the host (:root/html/body): ${sel}`);
    for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      const c = m[1];
      if (c !== 'shelf-sdk' && !c.startsWith('shelf-sdk__')) fail(`${file}: unprefixed class .${c} in: ${sel}`);
    }
    // Bare element rules ("button { ... }") would have been caught by the .shelf-sdk prefix test above.
  }
}
if (checked < minSelectors) fail(`${file}: only ${checked} selectors found; the stylesheet looks truncated`);

for (const a of atRules) {
  if (a.startsWith('@keyframes') && !/^@keyframes shelf-sdk-/.test(a)) fail(`${file}: unprefixed ${a}`);
  if (a.startsWith('@font-face')) continue;
  if (!/^@(keyframes|font-face)/.test(a)) fail(`${file}: unexpected at-rule: ${a}`);
}
// @font-face: families are "Shelf ...", files exist beside the stylesheet.
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
if (faces.length === 0) fail(`${file}: no @font-face rules`);
for (const f of faces) {
  const fam = /font-family:\s*"([^"]+)"/.exec(f)?.[1];
  if (!fam?.startsWith('Shelf ')) fail(`${file}: @font-face family must be "Shelf ...", got ${fam}`);
  // url() is relative to the stylesheet: ./fonts/ beside dist/styles.css, ../fonts/ from dist/css/
  const url = new RegExp(`url\\("?${fontRel.replace(/\./g, '\\.')}(fonts\\/[^")]+)"?\\)`).exec(f)?.[1];
  if (!url || !existsSync(`dist/${url}`)) fail(`${file}: @font-face file missing: ${url}`);
}
  return { checked, faces: faces.length, css };
}

const reports = [];
const main = checkCss('dist/styles.css', './', 100);
reports.push(`dist/styles.css: ${main.checked} selectors`);
const coreCss = checkCss('dist/css/core.css', '../', 20);
const coreBody = readFileSync('dist/css/core.css', 'utf8').replace(/^\/\*[\s\S]*?\*\/\n/, '');
for (const f of readdirSync('dist/css').filter((n) => n.endsWith('.css')).sort()) {
  const r = checkCss(`dist/css/${f}`, '../', coreCss.checked);
  if (f !== 'core.css' && !readFileSync(`dist/css/${f}`, 'utf8').includes(coreBody)) fail(`dist/css/${f} does not carry core.css (a component stylesheet must work alone)`);
  reports.push(`dist/css/${f}: ${r.checked}`);
}
for (const l of ['Geist-LICENSE.txt', 'Geist-Mono-LICENSE.txt', 'Instrument-Serif-LICENSE.txt']) {
  if (!existsSync(`dist/fonts/${l}`)) fail(`licence missing: dist/fonts/${l}`);
}
console.log(`check-dist: ok (${reports.length} stylesheets, every selector under .shelf-sdk, font urls resolve; ${reports.join('; ')})`);
