// Single source of truth for the package's entry points (0.4.0 plan). Read by tsup.config.ts (what to build), and by
// scripts/size-budget.mjs, check-imports.mjs and check-entries.mjs (what to verify). package.json "exports" is checked
// against this list by check-entries.mjs, so adding an entry means editing this file and the exports map together.
//
// Entry fields
//   subpath    the import specifier after the package name ('.' is the package root)
//   module     source file of the entry, relative to the repo root
//   out        tsup entry name: dist/<out>.{js,cjs,d.ts,d.cts}
//   client     true: dist/react/**/index.{js,cjs} get a leading "use client" (everything except '.')
//   css        { file, parts }: the per-entry stylesheet dist/css/<file>, built from src/styles/<part>.css (filled in by 0.4 U9-A)
//   banned     src path fragments the entry's STATIC import closure must not contain (check-imports.mjs)
//   scenarios  size budgets: gzip kB of what a consumer's bundler ships for `import {imports} from <entry>` ('*' = every export),
//              with dynamic import() chunks left out. initialKb is the ceiling; lazyKb (optional) caps the lazy chunks that
//              scenario can reach, at any depth.

export const PACKAGE = '@pj-slf-998231/sdk';

/** Number of createContext( calls in each output format of dist (one chunk shared by every entry; check-entries.mjs). */
export const EXPECTED_CONTEXTS = 1;

/** Never part of any entry's initial load: the document-site renderer and the offline outbox are lazy chunks. */
const LAZY_ONLY = ['src/docsite/', 'src/outbox/', 'src/react/DocumentContent'];
/** Display-only components: no session, cache, storage, virtual list, outbox, document site or document page. */
const LEAF = [...LAZY_ONLY, 'src/react/session', 'src/cache/', 'src/storage/', 'src/virtual/', 'src/react/DocumentPage', 'src/hooks/useFolderListing'];
const NO_DOCUMENT_PAGE = [...LAZY_ONLY, 'src/react/DocumentPage'];

const react = (name, extra) => ({
  subpath: `./react/${name}`,
  module: `src/entries/${name}.ts`,
  out: `react/${name}/index`,
  client: true,
  css: { file: `css/${name}.css`, parts: [] },
  banned: LAZY_ONLY,
  scenarios: [],
  ...extra,
});

export const entries = [
  {
    subpath: '.',
    module: 'src/index.ts',
    out: 'index',
    client: false,
    css: null,
    // The client alone: no react, cache engine, storage, outbox or virtual list. clearCache is part of the 0.3 surface; its
    // wrapper (src/cache/clear.ts) is a few lines that import() the storage code on demand, so only that file is allowed.
    banned: ['src/react/', 'src/cache/store', 'src/cache/swr', 'src/cache/thumbs', 'src/cache/reconcile', 'src/cache/clearImpl', 'src/cache/purgeRegistry', 'src/storage/', 'src/outbox/', 'src/virtual/', 'src/hooks/', 'src/docsite/', 'node_modules/@tanstack/'],
    scenarios: [{ name: '*', imports: '*', initialKb: 1.7 }],
  },
  {
    subpath: './react',
    module: 'src/react/index.ts',
    out: 'react/index',
    client: true,
    css: null,
    banned: NO_DOCUMENT_PAGE,
    // {ShelfFolder}: measured 30.17 kB (30.0 at the 0.3 baseline), +5%.
    scenarios: [
      { name: '*', imports: '*', initialKb: 33.0 },
      { name: '{ShelfFolder}', imports: ['ShelfFolder'], initialKb: 31.7 },
    ],
  },
  react('folder-view', { banned: NO_DOCUMENT_PAGE, scenarios: [{ name: '{ShelfFolder}', imports: ['ShelfFolder'], initialKb: 31.7 }] }),
  react('provider', { scenarios: [{ name: '*', imports: '*', initialKb: 8.8 }] }),
  react('hooks', {
    banned: NO_DOCUMENT_PAGE.concat('src/virtual/'),
    scenarios: [
      { name: '*', imports: '*', initialKb: 10.5 },
      { name: '{useFolders}', imports: ['useFolders'], initialKb: 8.5 },
    ],
  }),
  react('folder-card', { banned: LEAF, scenarios: [{ name: '*', imports: '*', initialKb: 2.5 }] }),
  react('folder-grid', { scenarios: [{ name: '*', imports: '*', initialKb: 11.5 }] }),
  react('folder-header', { scenarios: [{ name: '*', imports: '*', initialKb: 10.5 }] }),
  react('folder-toolbar', { scenarios: [{ name: '*', imports: '*', initialKb: 10.0 }] }),
  react('view-toggle', { banned: LEAF, scenarios: [{ name: '*', imports: '*', initialKb: 0.8 }] }),
  // The outbox is a lazy chunk (loaded for a read_write key): at most 6.0 kB.
  react('upload-dropzone', { scenarios: [{ name: '*', imports: '*', initialKb: 9.5, lazyKb: 6.0 }] }),
  react('document-card', { banned: LEAF, scenarios: [{ name: '*', imports: '*', initialKb: 4.2 }] }),
  react('document-gallery', { scenarios: [{ name: '*', imports: '*', initialKb: 23.5 }] }),
  react('document-list', { scenarios: [{ name: '*', imports: '*', initialKb: 23.5 }] }),
  react('document-page', {
    // DocumentPage is the thing this entry is for; the document-site renderer stays lazy.
    banned: LAZY_ONLY,
    scenarios: [
      { name: '*', imports: '*', initialKb: 12.5 },
      { name: '{DocumentTextTab}', imports: ['DocumentTextTab'], initialKb: 1.5 },
    ],
  }),
  react('offline-banner', { banned: LEAF, scenarios: [{ name: '*', imports: '*', initialKb: 1.3 }] }),
  react('action-menu', { banned: LEAF, scenarios: [{ name: '*', imports: '*', initialKb: 1.1 }] }),
  react('folder-tree', { scenarios: [{ name: '*', imports: '*', initialKb: 2.8 }] }),
];

/** Scenarios that combine several entries, as one consumer app would. */
export const combos = [
  {
    name: 'tiny example: {FolderCard} + {useFolders}',
    imports: [
      { subpath: './react/folder-card', names: ['FolderCard'] },
      { subpath: './react/hooks', names: ['useFolders'] },
    ],
    initialKb: 10.5,
  },
];

/**
 * All lazy chunks at every depth from `entry` (a lazy chunk's own import()s included, e.g. DocumentPage -> DocumentContent),
 * minus entry's initial load, summed, once.
 * 0.3 baseline: 10.29 kB measured without the nested chunk; 16.72 kB with it (budget = measured + 5%, plan ceiling 19.0).
 */
export const lazy = { entry: './react', totalKb: 17.6 };

/** Extra files in the package, outside the entries: reserved/produced by the build. */
export const staticExports = {
  './styles.css': './dist/styles.css',
  './css/*.css': './dist/css/*.css',
  './package.json': './package.json',
};

export const sideEffects = ['./dist/styles.css', './dist/css/*.css'];

export const distFile = (e, ext) => `dist/${e.out}.${ext}`;
