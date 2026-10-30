// Builds the per-entry stylesheets (0.4 U9-A):
//   dist/css/core.css        tokens + fonts + base reset (everything every component needs)
//   dist/css/<entry>.css     core.css + the rules of the classes that entry's components render
// dist/styles.css is NOT produced here (tsup.config.ts concatenates it exactly as 0.3 did).
//
// How an entry's rule set is derived (deterministic, no guessing at runtime):
//   1. The entry's source closure comes from the tsup metafile (static AND dynamic imports: a lazy chunk still renders).
//   2. Every class a source file renders is read from its cx(...) calls and from literal `shelf-sdk__x` strings. A template
//      such as cx(`pill--${tone}`) is a pattern that stands for every `pill--*` class in the stylesheet.
//   3. A class that appears in no rule anywhere is a build error (a typo would silently ship unstyled), unless it is listed in
//      UNSTYLED below with the reason.
//   4. A rule (one selector of a selector list) belongs to an entry when every class in it is rendered by that entry.
//   5. Order independence. Component stylesheets can be loaded in any order, and every file repeats core.css and the shared
//      rules. Two rules of equal specificity that set related properties and can meet on one element (their classes occur
//      together in one source file) are therefore a "conflict pair": the later one wins only because it comes later. A file
//      that holds one holds both, in source order, so loading any set of files in any order keeps the same winner.
//      Conflicts between core rules and class rules cannot be repaired by moving rules; they fail the build instead.
//   No @layer: a host's unlayered CSS beats layered rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const PREFIX = 'shelf-sdk__';

/** Classes rendered but deliberately without any rule (hooks for tests / host styling). Add with a reason; never silently. */
export const UNSTYLED = new Set([
  // Markup hooks: web's global.css has no rule for them either (the stylesheet is generated from it; checked by grep at U9-A).
  'doc-site-panel', 'doc-site-building', 'doc-site-updating', 'doc-text-panel', 'btn--icon', 'folder-tree-file', 'is-loading',
  'item-row--folder', 'panel-icon', 'file-icon--image', 'copy-icon', 'check-icon', 'pencil-icon', 'sync-btn',
]);

// ---------------------------------------------------------------------------------------------------------------- parsing

/** Top-level blocks of a stylesheet: [{ head, body (null for `@x ...;`), raw }]. Comments between blocks are dropped. */
export function parseCss(text) {
  const nodes = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    if (text.startsWith('/*', i)) { i = text.indexOf('*/', i) + 2; continue; }
    const start = i;
    let j = i, q = null, paren = 0;
    while (j < n) {
      const c = text[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (text.startsWith('/*', j)) j = text.indexOf('*/', j) + 1;
      else if ((c === '{' || c === ';') && paren === 0) break;
      j++;
    }
    const head = text.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (text[j] === ';') { nodes.push({ head, body: null, raw: text.slice(start, j + 1) }); i = j + 1; continue; }
    let depth = 1, k = j + 1;
    q = null;
    while (k < n && depth > 0) {
      const c = text[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (text.startsWith('/*', k)) k = text.indexOf('*/', k) + 1;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    nodes.push({ head, body: text.slice(j + 1, k - 1), raw: text.slice(start, k) });
    i = k;
  }
  return nodes;
}

export function splitSelectors(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** The part of a selector after the last top-level combinator (the compound that matches the element itself). */
export function subjectCompound(sel) {
  let depth = 0, last = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) last = i + 1;
  }
  return sel.slice(last);
}

const classRe = /\.(-?[_a-zA-Z][\w-]*)/g;
/** Classes an element must carry for the selector to match (classes inside :not() are not required). */
export function requiredClasses(sel) {
  let s = sel, prev;
  do { prev = s; s = s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ''); } while (s !== prev);
  s = s.replace(/\[[^\]]*\]/g, '');
  return new Set([...s.matchAll(classRe)].map((m) => m[1]));
}

/** [ids, classes/attributes/pseudo-classes, types/pseudo-elements] */
export function specificity(sel) {
  let s = sel.replace(/\[[^\]]*\]/g, '.a'); // attribute = one class
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const max = (list) => list.reduce((m, x) => (cmp(x, m) > 0 ? x : m), [0, 0, 0]);
  let total = [0, 0, 0];
  // functional pseudo-classes first: :not/:is/:has take the most specific argument, :where counts nothing
  for (;;) {
    const m = /:(not|is|has|where|matches)\(((?:[^()]|\([^()]*\))*)\)/.exec(s);
    if (!m) break;
    if (m[1] !== 'where') total = add(total, max(splitSelectors(m[2]).map(specificity)));
    s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
  }
  s = s.replace(/:[\w-]+\((?:[^()]|\([^()]*\))*\)/g, ':x'); // :nth-child(...) etc. = one pseudo-class
  total = add(total, [(s.match(/#[\w-]+/g) ?? []).length, (s.match(/\.[\w-]+|(?<!:):[\w-]+/g) ?? []).length, (s.match(/::[\w-]+/g) ?? []).length]);
  const stripped = s.replace(/::?[\w-]+/g, ' ').replace(/[.#][\w-]+/g, ' ');
  const types = stripped.split(/[\s>+~]+/).filter((t) => /^[a-zA-Z][\w-]*$/.test(t)).length;
  return add(total, [0, 0, types]);
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const declNames = (body) => {
  const out = new Set();
  const flat = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\([^()]*\)/g, '()');
  for (const d of flat.split(';')) {
    const m = /^\s*(--[\w-]+|[a-zA-Z-]+)\s*:/.exec(d);
    // !important declarations only compete with other !important ones: they win (or lose) in any order
    if (m) out.add(/!\s*important\s*$/.test(d) ? m[1] + '!' : m[1]);
  }
  return [...out];
};
const ALIAS = { 'line-height': 'font', 'font-size': 'font', top: 'inset', right: 'inset', bottom: 'inset', left: 'inset' };
const related = (a, b) => {
  if (a.endsWith('!') !== b.endsWith('!')) return false;
  a = a.replace(/!$/, '');
  b = b.replace(/!$/, '');
  if (a === b) return true;
  if (a.startsWith('--') || b.startsWith('--')) return false;
  const norm = (p) => ALIAS[p] ?? p;
  const x = norm(a), y = norm(b);
  return x === y || x.startsWith(y + '-') || y.startsWith(x + '-') || a.startsWith(b + '-') || b.startsWith(a + '-');
};

/**
 * Flattens stylesheet text into ordered atoms: one per selector of a style rule (at any @media/@supports depth), plus
 * keyframes / font-face blocks. `origin` names the source file; `ruleId` groups the selectors of one rule.
 */
export function atomsOf(text, origin, counter = { n: 0 }, wrappers = []) {
  const atoms = [];
  for (const node of parseCss(text)) {
    if (node.body === null) { atoms.push({ kind: 'stmt', origin, wrappers, raw: node.raw }); continue; }
    if (node.head.startsWith('@media') || node.head.startsWith('@supports')) {
      atoms.push(...atomsOf(node.body, origin, counter, [...wrappers, node.head]));
    } else if (node.head.startsWith('@keyframes')) {
      atoms.push({ kind: 'keyframes', origin, wrappers, name: node.head.split(/\s+/)[1], raw: node.raw });
    } else if (node.head.startsWith('@')) {
      atoms.push({ kind: 'at', origin, wrappers, raw: node.raw });
    } else {
      const ruleId = ++counter.n;
      const props = declNames(node.body);
      for (const selector of splitSelectors(node.head)) {
        const classes = requiredClasses(selector);
        classes.delete('shelf-sdk');
        const own = new Set([...subjectCompound(selector).matchAll(classRe)].map((m) => m[1]));
        own.delete('shelf-sdk');
        const tag = /^([a-zA-Z][\w-]*)/.exec(subjectCompound(selector))?.[1] ?? null;
        atoms.push({ kind: 'rule', origin, wrappers, ruleId, selector, tag, body: node.body, props, classes, subject: own, spec: specificity(selector), animations: animationNames(node.body) });
      }
    }
  }
  return atoms;
}
const animationNames = (body) => [...body.matchAll(/animation(?:-name)?\s*:\s*([^;]+)/g)].flatMap((m) => m[1].split(/[\s,]+/));

// ------------------------------------------------------------------------------------------------- source class scanning

/** Class names a source text renders. { literals: Set, patterns: RegExp[] (templates with ${}), dynamicCalls: string[] } */
export function scanSource(text) {
  const literals = new Set();
  const patterns = [];
  const dynamicCalls = [];
  const groups = []; // one { literals, patterns } per cx(...) call: the classes of one element
  let cur = null;
  const addToken = (tok) => {
    if (!tok) return;
    if (tok.includes('\u0000')) {
      const re = new RegExp('^' + tok.split('\u0000').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\w-]+') + '$');
      patterns.push(re);
      cur?.patterns.push(re);
    } else { literals.add(tok); cur?.literals.add(tok); }
  };
  // string-ish literals inside text (handles nested templates)
  const literalsIn = (src) => {
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        const before = src.slice(Math.max(0, i - 4), i).trimEnd();
        while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        // `x === 'pending'` compares, it does not render a class
        if (!/[=!]=$/.test(before) && !/^\s*[=!]==?/.test(src.slice(j + 1, j + 5))) for (const t of src.slice(i + 1, j).split(/\s+/)) addToken(t);
        i = j + 1;
      } else if (c === '`') {
        let j = i + 1, piece = '';
        while (j < src.length && src[j] !== '`') {
          if (src[j] === '$' && src[j + 1] === '{') {
            let d = 1, k = j + 2;
            while (k < src.length && d > 0) { if (src[k] === '{') d++; else if (src[k] === '}') d--; else if (src[k] === '`') { k = skipTemplate(src, k); continue; } k++; }
            literalsIn(src.slice(j + 2, k - 1));
            piece += '\u0000';
            j = k;
          } else { piece += src[j]; j++; }
        }
        // a placeholder glued to text is one token; a placeholder between spaces is a bare ${x} (nothing to learn)
        for (const t of piece.split(/\s+/)) if (t !== '\u0000') addToken(t);
        i = j + 1;
      } else i++;
    }
  };
  const skipTemplate = (src, k) => {
    let j = k + 1;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '$' && src[j + 1] === '{') {
        let d = 1, m = j + 2;
        while (m < src.length && d > 0) { if (src[m] === '{') d++; else if (src[m] === '}') d--; else if (src[m] === '`') { m = skipTemplate(src, m); continue; } m++; }
        j = m;
      } else j++;
    }
    return j + 1;
  };
  for (const m of text.matchAll(/\bcx\(/g)) {
    let d = 1, k = m.index + m[0].length;
    const start = k;
    while (k < text.length && d > 0) {
      const c = text[k];
      if (c === '(') d++; else if (c === ')') d--;
      else if (c === '`') { k = skipTemplate(text, k); continue; }
      else if (c === "'" || c === '"') { k++; while (k < text.length && text[k] !== c) k += text[k] === '\\' ? 2 : 1; }
      k++;
    }
    const args = text.slice(start, k - 1);
    cur = { literals: new Set(), patterns: [] };
    literalsIn(args);
    groups.push(cur);
    cur = null;
    if (/^\s*[A-Za-z_$][\w$.]*\s*$/.test(args)) dynamicCalls.push(args.trim()); // cx(someVariable): names unknown to the scanner
  }
  for (const m of text.matchAll(/shelf-sdk__([a-z0-9_-]+)/g)) literals.add(m[1]);
  return { literals, patterns, dynamicCalls, groups };
}

/** Source files an entry loads, static and dynamic imports alike, from a tsup metafile. */
export function closureOf(metafile, entryModule) {
  const seen = new Set();
  const stack = [entryModule];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !metafile.inputs[f]) continue;
    seen.add(f);
    for (const imp of metafile.inputs[f].imports) if (!imp.external) stack.push(imp.path);
  }
  return [...seen].filter((f) => /^src\/.*\.(ts|tsx)$/.test(f)).sort();
}

// --------------------------------------------------------------------------------------------------------------- the split

const header = (what) => `/*\n * ${what}\n * GENERATED by scripts/split-css.mjs from src/styles/*.css. Do not edit by hand.\n * Every selector is scoped to .shelf-sdk and every class is prefixed shelf-sdk__; the file works on its own.\n */\n`;
const fontsUp = (css) => css.replace(/url\("\.\/fonts\//g, 'url("../fonts/');

function emitAtoms(atoms) {
  const out = [];
  let open = [];
  const sameWrap = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const close = (to) => { while (open.length > to) { open.pop(); out.push('  '.repeat(open.length) + '}'); } };
  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i];
    // reuse the open wrappers' common prefix
    let common = 0;
    while (common < open.length && common < a.wrappers.length && open[common] === a.wrappers[common]) common++;
    close(common);
    for (let w = common; w < a.wrappers.length; w++) { out.push(`${'  '.repeat(w)}${a.wrappers[w]} {`); open.push(a.wrappers[w]); }
    const pad = '  '.repeat(open.length);
    if (a.kind === 'rule') {
      const sels = [a.selector];
      while (i + 1 < atoms.length && atoms[i + 1].kind === 'rule' && atoms[i + 1].ruleId === a.ruleId && sameWrap(atoms[i + 1].wrappers, a.wrappers)) sels.push(atoms[++i].selector);
      out.push(`${pad}${sels.join(`,\n${pad}`)} {${a.body.replace(/\s+$/, '')}\n${pad}}`);
    } else out.push(a.raw);
    i++;
  }
  close(0);
  return out.join('\n');
}

/**
 * @param {object} o
 * @param {Array<{out: string, module: string, css: {file: string}|null}>} o.entries
 * @param {object} o.metafile  tsup metafile (.build/metafile-esm.json)
 * @param {string} [o.dir]     repo root
 * @param {(f: string) => string} [o.read]  reads a repo-relative file (tests)
 * @returns {{ core: string, files: Record<string, string>, report: object }} files: dist-relative path -> css
 */
export function splitCss({ entries, metafile, dir = root, read = (f) => readFileSync(join(dir, f), 'utf8') }) {
  const style = (n) => read(`src/styles/${n}.css`);
  // 1. atoms of the generated + hand-written sheets, in styles.css order
  const counter = { n: 0 };
  const base = atomsOf(style('base'), 'base', counter);
  const classAtoms = [...base.filter((a) => a.kind === 'rule' && a.classes.size > 0), ...atomsOf(style('view'), 'view', counter), ...atomsOf(style('extras'), 'extras', counter)];
  const coreBase = base.filter((a) => !(a.kind === 'rule' && a.classes.size > 0));
  for (const a of classAtoms) {
    if (a.kind === 'rule' && a.classes.size === 0) throw new Error(`split-css: ${a.origin}.css has a rule with no .shelf-sdk__ class: ${a.selector} (it belongs in base.css)`);
  }
  classAtoms.forEach((a, i) => (a.order = i));
  const rules = classAtoms.filter((a) => a.kind === 'rule');

  // 2. the class universe of the stylesheet
  const known = new Set([...classAtoms, ...coreBase].flatMap((a) => (a.kind === 'rule' ? [...a.selector.matchAll(classRe)].map((m) => m[1]) : [])).filter((c) => c.startsWith(PREFIX)).map((c) => c.slice(PREFIX.length)));
  for (const a of rules) for (const c of a.classes) if (!c.startsWith(PREFIX)) throw new Error(`split-css: unprefixed class .${c} in ${a.selector}`);

  // 3. per source file: rendered classes
  const scanned = new Map();
  const scan = (f) => {
    if (!scanned.has(f)) {
      const s = scanSource(read(f));
      const set = new Set(s.literals);
      for (const re of s.patterns) {
        const hits = [...known].filter((c) => re.test(c));
        if (hits.length === 0) throw new Error(`split-css: ${f}: class pattern ${re} matches no rule`);
        hits.forEach((c) => set.add(c));
      }
      const groups = s.groups.map((g) => {
        const gs = new Set(g.literals);
        for (const re of g.patterns) for (const c of known) if (re.test(c)) gs.add(c);
        return gs;
      });
      scanned.set(f, { classes: set, dynamicCalls: s.dynamicCalls, groups });
    }
    return scanned.get(f);
  };
  const closures = new Map();
  const unknown = [];
  for (const e of entries) {
    const files = closureOf(metafile, e.module);
    const classes = new Set();
    for (const f of files) {
      const s = scan(f);
      for (const c of s.classes) {
        if (!known.has(c) && !UNSTYLED.has(c)) unknown.push(`${f}: "${c}"`);
        classes.add(c);
      }
    }
    closures.set(e.out, { files, classes });
  }
  if (unknown.length) throw new Error(`split-css: classes rendered but styled by no rule (typo? or add to UNSTYLED with a reason):\n  ${[...new Set(unknown)].join('\n  ')}`);

  // 4. conflict pairs (equal specificity, related properties, classes that meet in one source file)
  // An element's classes come from one cx() call, so two rules can meet on one element only if their subject classes share a
  // call. A rule whose subject is a bare tag (`.x svg`) meets another one only inside the same container chain.
  const groupSets = [...scanned.values()].flatMap((s) => s.groups);
  const subset = (x, y) => [...x].every((c) => y.has(c));
  const metIn = (a, b) => {
    if (a.subject.size === 0 || b.subject.size === 0) return subset(a.classes, b.classes) || subset(b.classes, a.classes);
    const need = [...a.subject, ...b.subject].map((c) => c.slice(PREFIX.length));
    return groupSets.some((g) => need.every((c) => g.has(c)));
  };
  const neighbours = new Map(rules.map((a) => [a, new Set()]));
  for (let i = 0; i < rules.length; i++) {
    const a = rules[i];
    for (let j = i + 1; j < rules.length; j++) {
      const b = rules[j];
      if (a.ruleId === b.ruleId || cmp(a.spec, b.spec) !== 0) continue;
      if (!a.props.some((p) => b.props.some((q) => related(p, q)))) continue;
      if (a.tag && b.tag && a.tag !== b.tag) continue; // different elements
      if (a.selector === b.selector) { neighbours.get(a).add(b); neighbours.get(b).add(a); continue; } // same selector: extras overriding view
      if (!metIn(a, b)) continue;
      neighbours.get(a).add(b);
      neighbours.get(b).add(a);
    }
  }

  // 5. core vs class rule conflicts: unfixable by grouping
  const coreRules = [...base.filter((a) => a.kind === 'rule' && a.classes.size === 0)];
  const coreConflicts = [];
  for (const c of coreRules) {
    if (!c.props.length) continue;
    for (const a of rules) {
      if (cmp(a.spec, c.spec) !== 0) continue;
      if (!c.props.some((p) => a.props.some((q) => related(p, q)))) continue;
      if (c.tag && a.tag && c.tag !== a.tag) continue; // different elements
      coreConflicts.push(`${c.selector} (core) vs ${a.selector}`);
    }
  }
  if (coreConflicts.length) throw new Error(`split-css: core rule(s) with the same specificity as, and related properties to, a class rule; raise the class rule's specificity or move the core rule:\n  ${coreConflicts.join('\n  ')}`);

  // 6. core.css
  const coreParts = [style('styles'), style('fonts'), emitAtoms(coreBase.filter((a) => a.kind !== 'stmt'))];
  const coreCss = fontsUp(coreParts.join('\n'));
  const files = { 'css/core.css': header('Shelf SDK core: tokens (light by default), fonts and the base reset. Every component stylesheet repeats this.') + coreCss };
  const report = { entries: {} };

  // 7. one file per entry
  for (const e of entries) {
    if (!e.css) continue;
    const { classes, files: srcFiles } = closures.get(e.out);
    const picked = new Set(rules.filter((a) => [...a.classes].every((c) => classes.has(c.slice(PREFIX.length)))));
    const direct = picked.size;
    const queue = [...picked];
    while (queue.length) for (const n of neighbours.get(queue.pop())) if (!picked.has(n)) { picked.add(n); queue.push(n); }
    const used = new Set([...picked].flatMap((a) => a.animations));
    const atoms = classAtoms.filter((a) => (a.kind === 'rule' ? picked.has(a) : a.kind === 'keyframes' ? used.has(a.name) : false));
    const css = fontsUp(coreParts.join('\n')) + '\n' + emitAtoms(atoms) + '\n';
    files[e.css.file] = header(`Shelf SDK: ${e.subpath}. core.css plus the rules of the classes this entry renders.`) + css;
    report.entries[e.out] = { sources: srcFiles.length, classes: classes.size, rules: direct, pulledByConflicts: picked.size - direct, bytes: files[e.css.file].length };
  }
  return { core: coreCss, files, report };
}
