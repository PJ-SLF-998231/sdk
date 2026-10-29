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
for (const f of ['dist/react/index.js', 'dist/react/index.cjs']) {
  if (!/["']react\/jsx-runtime["']/.test(readFileSync(f, 'utf8'))) fail(`${f} does not import react/jsx-runtime externally`);
}

const css = readFileSync('dist/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
if (!css.includes('.shelf-sdk')) fail('dist/styles.css is not scoped to .shelf-sdk');
if (/@import/.test(css)) fail('dist/styles.css has an @import (third-party requests are not allowed)');

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
    if (!/^\.shelf-sdk(?![\w-])/.test(sel)) fail(`unscoped selector: ${sel}`);
    if (/(^|[\s>+~(,])(:root|html|body)(?![\w-])/.test(sel)) fail(`selector reaches the host (:root/html/body): ${sel}`);
    for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      const c = m[1];
      if (c !== 'shelf-sdk' && !c.startsWith('shelf-sdk__')) fail(`unprefixed class .${c} in: ${sel}`);
    }
    // Bare element rules ("button { ... }") would have been caught by the .shelf-sdk prefix test above.
  }
}
if (checked < 100) fail(`only ${checked} selectors found; the stylesheet looks truncated`);

for (const a of atRules) {
  if (a.startsWith('@keyframes') && !/^@keyframes shelf-sdk-/.test(a)) fail(`unprefixed ${a}`);
  if (a.startsWith('@font-face')) continue;
  if (!/^@(keyframes|font-face)/.test(a)) fail(`unexpected at-rule: ${a}`);
}
// @font-face: families are "Shelf ...", files exist beside the stylesheet.
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
if (faces.length === 0) fail('no @font-face rules');
for (const f of faces) {
  const fam = /font-family:\s*"([^"]+)"/.exec(f)?.[1];
  if (!fam?.startsWith('Shelf ')) fail(`@font-face family must be "Shelf ...", got ${fam}`);
  const url = /url\("?\.\/(fonts\/[^")]+)"?\)/.exec(f)?.[1];
  if (!url || !existsSync(`dist/${url}`)) fail(`@font-face file missing: ${url}`);
}
for (const l of ['Geist-LICENSE.txt', 'Geist-Mono-LICENSE.txt', 'Instrument-Serif-LICENSE.txt']) {
  if (!existsSync(`dist/fonts/${l}`)) fail(`licence missing: dist/fonts/${l}`);
}
console.log(`check-dist: ok (${checked} selectors, all under .shelf-sdk; ${faces.length} font faces)`);
