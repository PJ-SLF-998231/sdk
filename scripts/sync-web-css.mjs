#!/usr/bin/env node
// Extracts the rules the folder view uses from Shelf web's global.css and
// rewrites them to live under .shelf-sdk with every class prefixed
// `shelf-sdk__`. Output: src/styles/view.css (generated; do not edit by hand).
// Usage: node scripts/sync-web-css.mjs path/to/web/src/styles/global.css
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] ?? process.env.SHELF_WEB_GLOBAL_CSS ?? resolve(root, '../shelf/web/src/styles/global.css'));
const out = resolve(root, 'src/styles/view.css');
const PREFIX = 'shelf-sdk__';

// Classes the view's markup uses (web names, unprefixed).
const EXACT = new Set(`card card-meta pill pill--ready pill--busy pill--warn pill--danger btn btn--sm btn--ghost btn--accent btn--danger
kicker visually-hidden breadcrumbs breadcrumb file-count drag-status dropzone-limits
folder-grid file-grid folder-icon chevron-icon file-icon upload-bar upload-bar--parsing is-dragging is-open is-selected
layout-toggle layout-toggle-btn callout callout--danger callout--warn notice empty empty-title empty--inline
preview-facts preview-muted status-note text-input field-error studio-actions parser-link
page-header page-header-aside section-eyebrow section-title
doc-layout doc-layout--rail doc-main doc-aside doc-aside-body doc-panel doc-panel-head doc-panel-actions doc-text doc-text-panel doc-content
doc-header doc-title doc-actions doc-body doc-tabs doc-nav-row doc-shelf-layout doc-shelf-layout--closed has-tree
shelf-tabs shelf-tab
doc-original doc-original-view doc-original-loading doc-original-loading-text doc-original-loading-size doc-original-text doc-image doc-frame
doc-status doc-site-panel doc-site-building doc-site-updating doc-site-note doc-link-btn doc-ai-rename-btn doc-panel--skeleton
skeleton-line skeleton-line--kicker skeleton-line--wide preview-placeholder progress progress-fill progress--indeterminate
btn--icon notice upload-bar--parsing item-list item-list-scroll item-list-num tag`.split(/\s+/));
const FAMILIES = [
  /^shelf-(layout|main|crumbs|toolbar|dropzone|section|sidebar|item)/,
  /^folder-(tile|tree|icon)/,
  /^file-(card|icon)/,
  /^item-/,
  /^action-menu/,
  /^layout-toggle/,
  /^pill--/,
  /^docsite/,
  /^on-this-page/,
  /^btn--/,
];
const wanted = (c) => EXACT.has(c) || FAMILIES.some((re) => re.test(c));

const docsiteSrc = resolve(dirname(src), 'docsite.css');
const css = [src, docsiteSrc]
  .map((f) => readFileSync(f, 'utf8').replace(/^@import[^;]*;/gm, ''))
  .join('\n');

// ---- tiny CSS block parser (comments and strings aware) ----
function parse(text) {
  const nodes = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    if (text.startsWith('/*', i)) {
      i = text.indexOf('*/', i) + 2;
      continue;
    }
    let j = i;
    let q = null;
    let paren = 0;
    while (j < n) {
      const c = text[j];
      if (q) {
        if (c === '\\') j++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (text.startsWith('/*', j)) j = text.indexOf('*/', j) + 1;
      else if ((c === '{' || c === ';') && paren === 0) break;
      j++;
    }
    const head = text.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (text[j] === ';') {
      nodes.push({ head, body: null });
      i = j + 1;
      continue;
    }
    let depth = 1;
    let k = j + 1;
    q = null;
    while (k < n && depth > 0) {
      const c = text[k];
      if (q) {
        if (c === '\\') k++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (text.startsWith('/*', k)) k = text.indexOf('*/', k) + 1;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    nodes.push({ head, body: text.slice(j + 1, k - 1) });
    i = k;
  }
  return nodes;
}

function splitSelectors(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Returns the rewritten selector, or null when it cannot be scoped faithfully.
function rewrite(sel) {
  const classes = [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  if (classes.length === 0 || !classes.every(wanted)) return null;
  let s = sel;
  let theme = '';
  s = s.replace(/^:root:not\(\[data-theme\]\)\s*/, () => ((theme = '[data-theme="auto"]'), ''));
  s = s.replace(/^\[data-theme=["']?(\w+)["']?\]\s*/, (_, t) => ((theme = `[data-theme="${t}"]`), ''));
  if (/(^|[\s>+~(])(html|body|:root|\*)([\s>+~.:#[]|$)/.test(s.replace(/\.[\w-]+/g, '.x'))) return null;
  s = s.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, c) => `.${PREFIX}${c}`);
  return `.shelf-sdk${theme} ${s}`.replace(/\s+/g, ' ');
}

const kept = [];
function emit(nodes, indent = '') {
  const lines = [];
  for (const node of nodes) {
    if (node.body === null) continue;
    if (node.head.startsWith('@media') || node.head.startsWith('@supports')) {
      const inner = emit(parse(node.body), indent + '  ');
      if (inner.length) lines.push(`${indent}${node.head} {`, ...inner, `${indent}}`);
    } else if (node.head.startsWith('@keyframes')) {
      const name = node.head.replace('@keyframes', '').trim();
      kept.push(name);
      lines.push(`${indent}@keyframes shelf-sdk-${name} {${node.body}}`);
    } else if (node.head.startsWith('@')) {
      continue;
    } else {
      const sels = splitSelectors(node.head).map(rewrite).filter(Boolean);
      if (!sels.length) continue;
      lines.push(`${indent}${sels.join(`,\n${indent}`)} {${node.body.replace(/\n(?=.)/g, '\n')}}`);
    }
  }
  return lines;
}

let body = emit(parse(css)).join('\n');
// Animation names follow their keyframes.
for (const name of new Set(kept)) {
  body = body.replace(new RegExp(`(animation(?:-name)?\\s*:[^;]*?)(?<![\\w-])${name}(?![\\w-])`, 'g'), `$1shelf-sdk-${name}`);
}

// Drop keyframes nothing in the kept rules uses.
for (const name of new Set(kept)) {
  const used = body.replace(new RegExp(`@keyframes shelf-sdk-${name} \\{[\\s\\S]*?\\n\\}\\n?`), '');
  if (!new RegExp(`(?<![\\w-])shelf-sdk-${name}(?![\\w-])`).test(used)) body = used;
}

let commit = process.env.SHELF_WEB_COMMIT ?? 'unknown';
try {
  if (commit !== 'unknown') throw new Error('given');
  commit = execFileSync('git', ['-C', dirname(src), 'log', '-1', '--format=%H', '--', src], { encoding: 'utf8' }).trim() || commit;
} catch {
  /* not a git checkout */
}
const header = `/*
 * GENERATED by scripts/sync-web-css.mjs. Do not edit by hand.
 * Source: web/src/styles/global.css and docsite.css in the Shelf repo (commit ${commit}),
 * only the rules the folder view, the document page and the document-site renderer use. Every class is prefixed "${PREFIX}" and
 * every selector sits under .shelf-sdk, so the host page is never restyled and
 * the host's CSS cannot reach in at a higher specificity than the component's.
 */

`;
writeFileSync(out, header + body + '\n');
console.log(`wrote ${out} (${body.split('\n').length} lines) from ${src} (${commit})`);
