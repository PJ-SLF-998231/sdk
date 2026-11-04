# @pj-slf-998231/sdk

Client and React UI for the Shelf folder integration API (`/api/v1/integration`). One package, used as little or as much as you need:

- A framework-free TypeScript client (`createShelfClient`), 1.6 kB gzipped.
- React hooks (`useFolders`, `useFolder`, `useDocument`, ...) that read the same cached, offline-capable data the UI uses.
- Standalone React components, each with its own subpath and stylesheet: `FolderCard`, `FolderGrid`, `FolderHeader`, `FolderToolbar`, `DocumentCard`, `DocumentGallery`, `DocumentList`, `DocumentPage`, `UploadDropzone`, `FolderTree` and more. See [Use only what you need](#use-only-what-you-need).
- The whole folder view, `<ShelfFolder>`, which renders Shelf web's own folder view, ported from its source: header with folder-tree toggle, breadcrumb and counts, Gallery/List toggle, folder cards, document cards or rows, drag-and-drop upload and the document page. It browses, opens, uploads, renames, moves and deletes documents and, with a `read_write` key, creates, renames, moves and deletes folders.

The package is public on npm under the `@pj-slf-998231` scope.

## Install

```sh
npm install @pj-slf-998231/sdk
```

`react` and `react-dom` (>= 18) are optional peer dependencies, needed only for `@pj-slf-998231/sdk/react`.

## Security model

A folder key (`shelf_ik_...`) is a bearer credential for one Shelf folder and the folders below it, **Read only** (`read`) or **Read and manage** (`read_write`).

- The key must never reach a browser: not in a bundle, not in a request, not in a cookie. Keep it in server-side configuration (for example a Fly secret).
- Browser-direct use is unsupported. Browsers talk to your own server, which authenticates the user and adds the key.
- Revoking the key in Shelf makes every call fail; the proxy then answers `503 not_configured` and the UI shows a "not configured" state instead of data (fail closed).

## Create a key

Keys are made in Shelf web, by the folder's owner. The folder integrations feature (the `folder_integrations` flag) must be on for the account; without it the menu item is not there and the API answers `404` to a new key.

1. Open the shelf, open the folder's menu and choose **Integrations…**.
2. **Platform**: name what the key is for, for example `Acme CRM` (required, at most 60 characters). It names the key in the list and in Shelf's activity log.
3. **Access**: **Read only** (`read`: list and read documents) or **Read and manage** (`read_write`: also upload, rename, move and delete documents, and create, rename, move and delete folders, all inside the folder). The key reaches the folder and the folders below it, including what is added later, and nothing else in the account.
4. **The key works**: **Until you revoke it**, **30 days**, **90 days** or **1 year**.
5. **Create key**. The key (`shelf_ik_...`) is shown once; **Copy key** and put it in your server's secret store (for example `SHELF_INTEGRATION_KEY`). Shelf cannot show it again. The dialog also shows the address to call; set `SHELF_API_URL` to that address's origin (without `/api/v1/integration`).

The same dialog lists the folder's keys with their last four characters, access, expiry and last use, and **Revoke** stops a key at once. A folder can have at most 10 working keys.

## Client modes

### Server (with an API key)

```ts
import { createShelfClient } from '@pj-slf-998231/sdk';

const shelf = createShelfClient({
  baseUrl: `${process.env.SHELF_API_URL}/api/v1/integration`,
  apiKey: process.env.SHELF_INTEGRATION_KEY, // sent as Authorization: Bearer
});

const { items, next_cursor } = await shelf.listFiles({ limit: 50 }); // items is always an array
const file = await shelf.upload(new Blob(['hello']), { filename: 'hello.txt' });
```

Methods: `info()`, `folders()`, `createFolder({ name, parent_id })`, `updateFolder(id, { name, parent_id })`, `deleteFolder(id)`, `listFiles({ folder_id, limit, cursor, recursive })`, `getFile(id)`, `upload(blob, { folder_id, filename, client_ref, on_duplicate })`, `updateFile(id, { filename, folder_id })`, `deleteFile(id)`, `thumbnailUrl(id, size?)`, `originalUrl(id, filename)`, `getSite(id)`. The folder writes need a `read_write` key. Failures throw `ShelfError` with `status`, `code` and optional `field`.

### Browser (through your proxy)

```ts
const shelf = createShelfClient({ baseUrl: '/api/shelf' }); // no apiKey
```

Requests are same-origin (`credentials: 'same-origin'`), so your session cookie authenticates the user and the proxy adds the key.

## Server-side proxy recipe

Browsers reach Shelf only through a proxy on your server, mounted at `/api/shelf/*`. A proxy written for 0.3 lacks the site route and the three folder-write routes; add them before you hand a `read_write` key to a 0.4 `ShelfFolder`, or its folder controls and document site will fail.

The proxy forwards `/api/shelf/<path>` to `${SHELF_API_URL}/api/v1/integration/<path>` and adds
`Authorization: Bearer ${SHELF_INTEGRATION_KEY}`. It runs behind your own session check, allows only the integration
routes, and **streams** both directions so uploads and originals are never buffered in memory. Mount it **before**
`express.json()` so request bodies are still unread streams. The recipe is the same in `@pj-slf-998231/sdk` and
`@pj-slf-998231/sdk-react-native`.

Route table (anything else: 404, do not forward). The folder-write routes (the last three) need a `read_write` key;
drop them if your integration never writes folders.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | key and folder info |
| GET | `/folders` | folders reachable by the key |
| GET | `/files?folder_id&limit&cursor&recursive` | list |
| GET | `/files/{id}` | details and text |
| GET | `/files/{id}/thumbnail?size` | image preview |
| GET | `/files/{id}/site` | the document's generated site (404 when it has none) |
| GET | `/files/{id}/original/{name}` | download; stream the body |
| POST | `/files` | multipart: `file`, `folder_id`, `client_ref`, `on_duplicate`; stream the body |
| PATCH | `/files/{id}` | rename or move (JSON) |
| DELETE | `/files/{id}` | move to the Shelf trash |
| POST | `/folders` | create a folder (JSON `{ name, parent_id }`) |
| PATCH | `/folders/{id}` | rename or move a folder (JSON) |
| DELETE | `/folders/{id}` | move a folder and everything in it to the Shelf trash |

Header allowlist. Forward only these and drop everything else, in particular the caller's `Authorization`, `Cookie`
and `Host`, and any `X-Forwarded-*`, `X-Real-IP` or `Fly-Client-IP` they send.

- Request to Shelf: `Accept`, `Content-Type` (keeps the multipart boundary), `Content-Length`, `If-None-Match`, `Range`,
  `If-Range`.
- Response to the caller: `Content-Type`, `Content-Length`, `Content-Disposition`, `Content-Range`, `Accept-Ranges`,
  `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `X-Content-Type-Options`, `Retry-After`.

Why these: Shelf sends an `ETag` with thumbnails, originals and document sites (and, as it adds them, with listings and
details) and answers a matching `If-None-Match` with `304` and no body, so pass the `304` through as it is.
`Cache-Control` is `private` (or `no-store`) on everything; keep it, so no shared cache between your users stores one
user's answer. Originals and thumbnails carry `X-Content-Type-Options: nosniff`. `Range` and `If-Range` are forwarded
for originals; Shelf answers them with the whole file (`200`) today, and with `206` and `Content-Range` if it starts to
honour them. A `429` carries `Retry-After` in seconds. Drop `Content-Length` when Shelf's answer had a
`Content-Encoding`: `fetch` hands you the decoded body, so the length no longer matches.

Errors the proxy produces itself:

| Condition | Response |
| --- | --- |
| No valid user session | 401 (your own auth) |
| `SHELF_API_URL` or `SHELF_INTEGRATION_KEY` unset, or Shelf answers 401 (key revoked, expired or invalid) | `503 {"code":"not_configured"}` (fail closed) |
| Shelf unreachable or times out | 502 |
| Method or path not in the route table | 404 |
| Any other Shelf answer (304, 400, 403, 404, 409, 413, 415, 429, 5xx) | pass through the status, the allowed headers and the body |

Rate limits. Shelf allows 600 `/integration` requests a minute per client address, and behind the proxy that address is
the proxy's, so all your users share one budget. Rate-limit the route per user on your side and pass Shelf's `429` with
its `Retry-After` through.

```js
// shelf-proxy.mjs  (Node 18+, Express 4/5)
import { Readable } from 'node:stream';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ALLOWED = [
  ['GET', /^\/?$/],
  ['GET', /^\/folders\/?$/],
  ['GET', /^\/files\/?$/],
  ['GET', new RegExp(`^/files/${UUID}/?$`)],
  ['GET', new RegExp(`^/files/${UUID}/thumbnail/?$`)],
  ['GET', new RegExp(`^/files/${UUID}/site/?$`)],
  ['GET', new RegExp(`^/files/${UUID}/original/[^/]+$`)],
  ['POST', /^\/files\/?$/], // multipart upload
  ['PATCH', new RegExp(`^/files/${UUID}/?$`)],
  ['DELETE', new RegExp(`^/files/${UUID}/?$`)],
  ['POST', /^\/folders\/?$/], // folder writes, read_write keys only
  ['PATCH', new RegExp(`^/folders/${UUID}/?$`)],
  ['DELETE', new RegExp(`^/folders/${UUID}/?$`)],
];
const FORWARD_REQUEST = ['accept', 'content-type', 'content-length', 'if-none-match', 'range', 'if-range'];
const FORWARD_RESPONSE = ['content-type', 'content-length', 'content-disposition', 'content-range', 'accept-ranges',
  'etag', 'last-modified', 'cache-control', 'vary', 'x-content-type-options', 'retry-after'];

const fail = (res, status, code, message) => res.status(status).set('Cache-Control', 'no-store').json({ error: code, code, message });

function allowed(method, path) {
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) return false;
  // No dot segments or encoded separators in the file name segment.
  return !path.split('/').some((s) => {
    try { const d = decodeURIComponent(s); return d === '.' || d === '..' || d.includes('/') || d.includes('\\'); } catch { return true; }
  });
}

export async function shelfProxy(req, res) {
  if (!allowed(req.method, req.path)) return fail(res, 404, 'not_found', 'No such Shelf route');

  const base = (process.env.SHELF_API_URL ?? '').replace(/\/+$/, '');
  const key = process.env.SHELF_INTEGRATION_KEY ?? ''; // server-side secret; never sent to the browser or the app
  if (!base || !key) return fail(res, 503, 'not_configured', "Shelf isn't connected");

  const q = req.url.indexOf('?');
  const target = `${base}/api/v1/integration${req.path.replace(/\/+$/, '')}${q === -1 ? '' : req.url.slice(q)}`;
  const headers = { Authorization: `Bearer ${key}` };
  for (const h of FORWARD_REQUEST) if (req.headers[h] !== undefined) headers[h] = req.headers[h];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.method === 'POST' ? 120_000 : 30_000);
  res.on('close', () => { clearTimeout(timer); if (!res.writableFinished) ctrl.abort(); }); // caller went away: stop upstream too

  let up;
  try {
    up = await fetch(target, {
      method: req.method, headers, redirect: 'manual', signal: ctrl.signal,
      ...(req.method === 'POST' || req.method === 'PATCH' ? { body: req, duplex: 'half' } : {}), // stream the upload up
    });
  } catch {
    clearTimeout(timer);
    return fail(res, 502, 'unavailable', 'Shelf is unreachable');
  }
  // Shelf refused the key: a configuration problem, never the user's login problem. Tell the SDK so it stops.
  if (up.status === 401) { clearTimeout(timer); up.body?.cancel().catch(() => {}); return fail(res, 503, 'not_configured', "Shelf isn't connected"); }

  res.status(up.status); // 304 included: it has no body
  const decoded = up.headers.has('content-encoding'); // fetch decoded the body, so Shelf's length no longer applies
  for (const h of FORWARD_RESPONSE) {
    const v = up.headers.get(h);
    if (v !== null && !(decoded && h === 'content-length')) res.setHeader(h, v);
  }
  if (!up.body) return res.end();
  const body = Readable.fromWeb(up.body);
  body.on('error', () => res.destroy());
  body.pipe(res); // stream the response (thumbnails, originals) down
}
```

```js
// app.js
import express from 'express';
import { shelfProxy } from './shelf-proxy.mjs';

const app = express();
// requireUser: verify YOUR session first (the cookie session of a web page, or the bearer token an app sends).
app.use('/api/shelf', requireUser, shelfProxy); // before express.json()
app.use(express.json());
```

Also: keep the key in your secret manager, give it the narrowest access that works (`Read only` unless the integration
writes), set a body size limit on your edge, and never log the `Authorization` header you add.

## Use only what you need

The package is split so a page ships only what it uses. Every piece below has its own subpath, its own stylesheet, and none of them needs the others: the smallest page (the client alone) is 1.6 kB gzipped, one folder card plus the folders hook is 10.5 kB, and the whole folder view is 33.8 kB. Four ways to use it, smallest first. The examples are type-checked against the built package (`npm run check:readme`).

### 1. The client alone

No React, no cache, no storage. This is also what a server uses.

```ts check
import { createShelfClient } from '@pj-slf-998231/sdk';

const shelf = createShelfClient({ baseUrl: '/api/shelf' }); // same-origin proxy; no apiKey in the browser

export async function newestDocuments() {
  const { items } = await shelf.listFiles({ limit: 20 });
  return items.map((item) => item.filename);
}
```

### 2. One component on its own

A display component takes data as props and needs no provider. `FolderCard` is pure display; `DocumentCard` loads its thumbnail through the `client` you give it (or the nearest `ShelfProvider`).

```tsx check
import { createShelfClient } from '@pj-slf-998231/sdk';
import type { ShelfFolderRecord, ShelfItem } from '@pj-slf-998231/sdk';
import { DocumentCard } from '@pj-slf-998231/sdk/react/document-card';
import { FolderCard } from '@pj-slf-998231/sdk/react/folder-card';
import '@pj-slf-998231/sdk/css/folder-card.css';
import '@pj-slf-998231/sdk/css/document-card.css';

const client = createShelfClient({ baseUrl: '/api/shelf' });

export function Card({ folder, item }: { folder: ShelfFolderRecord; item: ShelfItem }) {
  return (
    <>
      <FolderCard folder={folder} itemCount={folder.item_count} onOpen={(id) => console.log('open folder', id)} />
      <DocumentCard client={client} item={item} onOpen={(id) => console.log('open document', id)} />
    </>
  );
}
```

### 3. A custom page from parts and hooks

The hooks give you the data (`useFolders`, `useFolder`, `useDocument`, `useDocumentText`, `useDocumentSite`, `useUpload`, `useOutbox`, `useOnlineStatus`, `useDocumentActions`, `useFolderActions`, `useShelf`); the parts draw it. A `ShelfProvider` above them gives all of them one Shelf, one cache and one theme; each part also takes `client` or `baseUrl` itself.

```tsx check
import { useState } from 'react';
import { DocumentGallery } from '@pj-slf-998231/sdk/react/document-gallery';
import { DocumentPage } from '@pj-slf-998231/sdk/react/document-page';
import { FolderGrid } from '@pj-slf-998231/sdk/react/folder-grid';
import { FolderHeader } from '@pj-slf-998231/sdk/react/folder-header';
import { useFolder } from '@pj-slf-998231/sdk/react/hooks';
import { ShelfProvider } from '@pj-slf-998231/sdk/react/provider';
import '@pj-slf-998231/sdk/css/folder-header.css';
import '@pj-slf-998231/sdk/css/folder-grid.css';
import '@pj-slf-998231/sdk/css/document-gallery.css';
import '@pj-slf-998231/sdk/css/document-page.css';

function Browser() {
  const [folderId, setFolderId] = useState<string | null>(null); // null: the key's folder
  const [documentId, setDocumentId] = useState<string | null>(null);
  const { items, subfolders, complete, loadMore } = useFolder(folderId);

  if (documentId) return <DocumentPage documentId={documentId} onClose={() => setDocumentId(null)} />;
  return (
    <>
      <FolderHeader folderId={folderId} onNavigate={setFolderId} meta={`${items.length} documents · ${subfolders.length} folders`} />
      <FolderGrid folderId={folderId} onOpenFolder={setFolderId} />
      <DocumentGallery items={items} onOpen={setDocumentId} onNearEnd={() => void (complete || loadMore())} />
    </>
  );
}

export function Files({ userId }: { userId: string }) {
  return (
    <ShelfProvider baseUrl="/api/shelf" cacheScope={userId}>
      <Browser />
    </ShelfProvider>
  );
}
```

### 4. The whole folder view

Header, breadcrumb, folder tree, Gallery and List, folder cards, uploads, the document page and, for a `read_write` key, the folder and document controls. See [The folder view](#the-folder-view-shelffolder).

```tsx check
import { ShelfFolder } from '@pj-slf-998231/sdk/react';
import '@pj-slf-998231/sdk/styles.css';

export function Files({ userId, signOut }: { userId: string; signOut: () => void }) {
  return <ShelfFolder baseUrl="/api/shelf" cacheScope={userId} onAuthLost={signOut} />;
}
```

### Entry points

Gzipped, minified, `react` and `react-dom` external, measured by `scripts/size-budget.mjs` on the 0.4.0 build. **Initial** is what a bundler ships for `import { everything } from <subpath>` (the entry and the chunks it imports statically). **Lazy** is the most that can load later, on demand, never all at once (the outbox for a `read_write` key, the document page, the document-site renderer, the folder tree, dialogs). **Needs** is where the component gets its Shelf: `client` / `baseUrl` props, the nearest `ShelfProvider`, or nothing (display only).

| Subpath | Exports | Initial | Lazy | Needs |
| --- | --- | ---: | ---: | --- |
| `@pj-slf-998231/sdk` | `createShelfClient`, `isAuthLost`, `isOfflineError`, `ShelfError`, `clearCache`, types | 1.57 kB | 1.92 kB | nothing (it is the client) |
| `/react` | everything below as one barrel (`ShelfFolder`, `ShelfProvider`, hooks, all parts) | 34.00 kB | 19.62 kB | `client`, `baseUrl` or provider |
| `/react/folder-view` | `ShelfFolder` | 33.84 kB | 19.44 kB | `client`, `baseUrl` or provider |
| `/react/provider` | `ShelfProvider`, `useShelf` | 8.01 kB | 6.89 kB | its own props |
| `/react/hooks` | `useShelf`, `useFolders`, `useFolder`, `useDocument`, `useDocumentText`, `useDocumentSite`, `useUpload`, `useOutbox`, `useOnlineStatus`, `useDocumentActions`, `useFolderActions` | 11.29 kB (`useFolders` alone 8.62 kB) | 7.15 kB | `client`, `baseUrl` or provider |
| `/react/folder-card` | `FolderCard`, `FolderNameForm` | 2.17 kB | none | nothing (display only) |
| `/react/folder-grid` | `FolderGrid` | 11.50 kB | 7.15 kB | `folders` prop, or `folderId` with `client`, `baseUrl` or provider |
| `/react/folder-header` | `FolderHeader` | 10.01 kB | 7.15 kB | `crumbs` prop, or `folderId` with `client`, `baseUrl` or provider |
| `/react/folder-toolbar` | `FolderToolbar` | 1.42 kB | none | nothing (display only) |
| `/react/view-toggle` | `ViewToggle` | 0.69 kB | none | nothing (display only) |
| `/react/upload-dropzone` | `UploadDropzone` | 8.67 kB | 6.89 kB | `onFiles`, or `client`, `baseUrl` or provider |
| `/react/document-card` | `DocumentCard` | 3.93 kB | none | nothing; `client` or provider for thumbnails |
| `/react/document-gallery` | `DocumentGallery` | 23.48 kB | 9.48 kB | `items` prop, or `folderId` with `client`, `baseUrl` or provider |
| `/react/document-list` | `DocumentList` | 23.80 kB | 9.51 kB | `items` prop, or `folderId` with `client`, `baseUrl` or provider |
| `/react/document-page` | `DocumentPage`, `DocumentTextTab`, `DocumentPreviewTab`, `DocumentContentTab` | 14.13 kB (`DocumentTextTab` alone 1.28 kB) | 13.72 kB | `client`, `baseUrl` or provider (the tabs take their data as props) |
| `/react/offline-banner` | `OfflineBanner` | 0.96 kB | none | nothing |
| `/react/action-menu` | `ActionMenu` | 1.11 kB | none | nothing |
| `/react/folder-tree` | `FolderTree` | 2.59 kB | none | nothing (display only) |
| `/styles.css` | all styles in one file | | | |
| `/css/<entry>.css` | the styles of one entry, see [CSS](#css) | | | |

The numbers overlap: the entries share chunks, so a page that uses three of them costs less than the sum. `examples/folder-card-only/` is the smallest useful page, one `FolderCard` fed by `useFolders`: 10.50 kB (ceiling 10.5 kB), and its bundle contains no document page, virtual list, document-site renderer or outbox code (`node examples/folder-card-only/size.mjs`).

Every `/react/*` entry starts with `"use client"` (the root entry does not), so they can be imported from a React Server Components tree; see [Server rendering](#server-rendering-and-nextjs).

### CSS

Either way, the stylesheet is imported by you (the SDK injects nothing, so a strict Content-Security-Policy and server rendering work without extra steps):

- **Everything:** `import '@pj-slf-998231/sdk/styles.css'`. One file, every rule, the fonts.
- **Per component:** `import '@pj-slf-998231/sdk/css/<entry>.css'`, where `<entry>` is the last segment of the subpath: `folder-card.css`, `folder-grid.css`, `folder-header.css`, `folder-toolbar.css`, `view-toggle.css`, `upload-dropzone.css`, `document-card.css`, `document-gallery.css`, `document-list.css`, `document-page.css`, `offline-banner.css`, `action-menu.css`, `folder-tree.css`, `folder-view.css` (for `ShelfFolder`), or `core.css` (tokens, fonts and the shared base alone). Each file is self-sufficient: it carries `core.css` and the rules of the classes that entry renders. The hooks and the provider draw nothing, so they have no stylesheet.

You can load any set of these, in any order, together with `styles.css` or without it. That is guaranteed and proven: `harness/parts.mjs` renders every component alone in Chromium and compares the browser's computed styles for every element and pseudo-element under four setups (`styles.css` alone, the component's own file alone, every file forward, every file reverse): 0 differing properties out of 1.69 million compared, and the pixels of each component under a deliberately hostile host stylesheet differ from a plain host by 0 (the limit is 2). `node scripts/check-css.mjs` fails the build when a class the code renders has no rule in the files. Reproduce: `npm run build && node harness/parts.mjs --shots docs/screenshots/parts`.

### Tokens

The design tokens are CSS custom properties declared on `.shelf-sdk`. Override one on `.shelf-sdk` (or through `className`), or set `theme`. Values are those of the 0.4.0 `styles.css`; `npm run check:tokens` fails when a token declared there is missing from this table.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--accent` | `#eab308` | `#facc15` | the accent colour |
| `--accent-ink` | `#1c1500` | `#171300` | text drawn on the accent |
| `--accent-text` | `#866300` | `var(--accent)` | the accent as text; darkened on white to pass WCAG AA |
| `--bg` | `#ffffff` | `#121210` | background |
| `--bg-soft` | 3% of `--fg` over `--bg` | `#1a1a17` | cards, panels, hover |
| `--fg` | `#14140f` | `#f3f2ea` | text |
| `--fg-soft` | `#57564c` | `#a8a79c` | secondary text |
| `--muted` | `#6e6d64` | `#8e8d86` | small mono labels (AA on `--bg` and `--bg-soft`) |
| `--cta-accent` | `var(--accent)` | `#866300` | the accent inside a card drawn in `--fg` |
| `--line` | `rgba(20, 20, 15, 0.12)` | `rgba(255, 255, 255, 0.12)` | borders |
| `--line-soft` | `rgba(20, 20, 15, 0.07)` | `rgba(255, 255, 255, 0.07)` | hairlines |
| `--danger` | `#b91c1c` | `#f87171` | errors and destructive actions (AA in both themes) |
| `--code-keyword` | violet mixed into `--fg` | `#c4b5fd` | code highlighting in the document site |
| `--code-string` | green mixed into `--fg` | `#86efac` | code highlighting |
| `--code-number` | orange mixed into `--fg` | `#fdba74` | code highlighting |
| `--code-title` | blue mixed into `--fg` | `#93c5fd` | code highlighting |
| `--code-type` | `var(--accent-text)` | same | code highlighting |
| `--code-comment` | `var(--muted)` | same | code highlighting |
| `--font-sans` | `"Geist", ui-sans-serif, system-ui, ...` | same | body text |
| `--font-serif` | `"Instrument Serif", "Times New Roman", Georgia, serif` | same | display headings |
| `--font-mono` | `"Geist Mono", ui-monospace, ...` | same | labels, counts, meta |
| `--radius` | `10px` | same | corner radius |
| `--shadow` | soft two-layer shadow | darker shadow | card elevation |
| `--maxw` | `960px` | same | maximum content width |
| `--maxw-wide` | `1180px` | same | wide maximum content width |
| `--pad-x` | `clamp(20px, 5vw, 64px)` | same | horizontal page padding |
| `--ease-out` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | same | easing curve |

### Theming

`theme` is `'light'`, `'dark'` or `'auto'` and is set on `ShelfFolder`, `ShelfProvider` or any standalone component that draws its own root. **The default is `'light'`**, whatever the visitor's operating system prefers, so a light-only host never shows a dark embed to dark-mode visitors. `'auto'` (follow `prefers-color-scheme`) is opt-in. The SDK does not read an ancestor's `data-theme` or `color-scheme`: a host with its own dark mode passes it, for example `theme={isDark ? 'dark' : 'light'}` on the provider. A part inside `ShelfFolder` or another SDK root takes the theme of that root.

### ShelfProvider

Optional. It gives the hooks and the data-bound components below it one Shelf, so they need no `client` or `baseUrl` of their own. A component's own `client` or `baseUrl` wins over the provider (order: `client` prop, then `baseUrl` prop, then the provider, then "not connected").

| Prop | Default | |
| --- | --- | --- |
| `client` | | A ready client from `createShelfClient`. Wins over `baseUrl`. |
| `baseUrl` | | The integration API or your same-origin proxy (`/api/shelf`). One client is created and reused per base URL. |
| `cacheScope` | none | A stable, non-secret id of who is signed in (a user or tenant id). Keeps data on this device under that id; without it, or with `false`, nothing is stored. See [Local-first cache](#local-first-cache) and the host checklist there. |
| `onAuthLost` | | Called once with the `ShelfError` when the key stops working (401 or the proxy's `503 not_configured`). The scope's cache is purged first. |
| `offline` | on | `{ outbox?: boolean, uploadConcurrency?: number, maxAttempts?: number }`. `outbox: false` turns the offline outbox off, and with it the write controls of `ShelfFolder` (uploads, rename, move, delete, folders): the embed becomes read-only even for a `read_write` key. `uploadConcurrency` is 3 by default, `maxAttempts` 8. |
| `theme` | `'light'` | `'light'`, `'dark'` or `'auto'`. See [Theming](#theming). |
| `showPreviewSizes` | `true` | Default for every document page below. `false` hides the Small / Medium / Large / Original bar over an image preview. |
| `documentTabs` | `['text', 'preview', 'content']` | Default for every document page below: which tabs, in what order. |

### ShelfFolder props

| Prop | Default | |
| --- | --- | --- |
| `client` / `baseUrl` | provider's | The Shelf to show; see [ShelfProvider](#shelfprovider) for the order. |
| `cacheScope`, `onAuthLost` | | As on `ShelfProvider`. |
| `theme` | `'light'` | `'light'`, `'dark'` or `'auto'`. |
| `className` | | Added to the root element. |
| `initialFolderId` | the key's folder | Folder to open first, and the top of the breadcrumb. |
| `documentId` | uncontrolled | Controlled: a document id shows that document's page, `null` the folder. While set, the host owns it: update it from `onNavigate`. |
| `initialDocumentId` | | Document to open first when `documentId` is not controlled (a deep link). |
| `onNavigate` | | `({ folderId, documentId }) => void`, called when the user opens a folder or a document or goes back; mirror it in your URL. |
| `showPreviewSizes` | `true` (or the provider's) | `false` hides the Small / Medium / Large / Original bar over an image preview on the document page. The image still shows, at the size it opens with (the original, as wide as its container, loaded lazily). PDFs and other previews are unaffected. |
| `documentTabs` | `['text', 'preview', 'content']` (or the provider's) | Which tabs the document page shows and in what order. A listed tab that does not apply (Content for a document without a generated site) is skipped, and the page opens on the **first available** tab: `['content', 'preview', 'text']` opens a document with a site on Content and one without on Preview. Arrow keys, Home and End move between the tabs in the order shown. |

Aisle's embed, as an example: the preview-size bar is hidden and Content comes first, then Preview, then Text.

```tsx check
import { ShelfFolder } from '@pj-slf-998231/sdk/react';
import '@pj-slf-998231/sdk/styles.css';

const aisle = { documentTabs: ['content', 'preview', 'text'], showPreviewSizes: false } as const;

export function AisleFiles({ userId }: { userId: string }) {
  return <ShelfFolder baseUrl="/api/shelf" cacheScope={userId} {...aisle} />;
}
```

Screenshots of the document page with the bar shown and hidden and with the tab orders: `docs/screenshots/doc-tabs-preview-sizes-default-1280.png`, `doc-tabs-preview-sizes-off-1280.png`, `doc-tabs-order-content-preview-text-1280.png`.

### Server rendering and Next.js

- Every `/react/*` entry (and the `/react` barrel) begins with `"use client"`, so you can import them from a Server Component file and Next treats them as client components. The root entry (`createShelfClient`, `clearCache`) has no directive and runs anywhere.
- There is no session on the server. During server rendering the hooks report `loading` / `status: 'connecting'`, nothing is fetched, no timer starts and no storage is touched; the data arrives after hydration. What the server renders is the loading state.
- Never create the client with an `apiKey` in a component that reaches the browser; use the same-origin proxy (`baseUrl="/api/shelf"`).
- Import the stylesheets from your root layout or from the client component; the SDK does not inject CSS.

```tsx
// app/files/page.tsx (a Server Component): import the client component and render it
import { Files } from './Files'; // 'use client' file that renders <ShelfFolder baseUrl="/api/shelf" cacheScope={userId} />
```

### Two copies of the SDK

A `ShelfProvider` is seen only by components from the same copy of the package. If two versions of the SDK are installed, or the host mixes `require` and `import` (the package ships both, each with its own React context), a component from the other copy does not see the provider. It does not break: it falls back to its own props (`client` or `baseUrl`), and shows "Shelf isn't connected" when it has none. Fixes: install one version, import the provider and the components the same way, or pass `client` / `baseUrl` to each component.

## The folder view (ShelfFolder)

### What it shows

The markup, class structure, CSS, tokens and icons are ported from Shelf web (`src/pages/ShelfPage.tsx`, `src/components/shelf/*`, `src/styles/global.css`, `tokens.css`), so the embed looks like Shelf's own folder view:

- Header row: a folder-icon button that opens the folder tree, the breadcrumb (ancestors muted, current folder bold), mono meta such as `1 ITEM · 5 FOLDERS`.
- Toolbar: **Add documents** (read_write keys only) and the **Gallery | List** toggle.
- A `FOLDERS` section of folder cards, a `DOCUMENTS` section of document cards (thumbnail, status pill, name, `SIZE · TYPE`), or in List mode a table of the same.
- A drop hint, `Drop documents here to add them to <folder> · PDF, Word, ...`. Dropping files anywhere on the view uploads them (read_write only).
- Click a document for the document page: type and size, filename, Text and Preview tabs, a Details panel, Download, and a Rename / Move to / Delete menu (read_write only). Delete moves the file to the Shelf trash; it can be restored in Shelf.
- A `503 not_configured` shows a "Shelf isn't connected" state.

The Gallery/List choice is remembered in `localStorage` (`shelf-sdk.layout`), and so is whether the folder tree is open (`shelf-sdk.folderTree`) and whether a document's Details panel is shown (`shelf-sdk.docDetails`, open by default). If storage is unavailable (private windows, locked-down hosts) both still toggle, they are just not remembered.

### The document page on its own

`DocumentPage` (also `DocumentTextTab`, `DocumentPreviewTab` and `DocumentContentTab`) from `@pj-slf-998231/sdk/react/document-page` draws one document without the folder view: `<DocumentPage documentId="..." client={client} />`, or inside a `ShelfProvider`. Options of the page and, where it applies, of its tabs:

| Prop | Default | |
| --- | --- | --- |
| `showPreviewSizes` | `true` | `false` hides the Small / Medium / Large / Original bar over an image preview; the image still shows, at the size it opens with (the original, as wide as its container, loaded lazily). PDFs and other previews are unaffected. Also on `DocumentPreviewTab`. |
| `documentTabs` | `['text', 'preview', 'content']` | Which tabs, in what order. A listed tab that does not apply (Content for a document without a generated site) is skipped; the page opens on the first one that is available, so `['content', 'preview', 'text']` opens a document with a site on Content and one without on Preview. Arrow keys, Home and End move between the tabs in the order shown. |
| `actions` | none | `{ rename, move, delete }` callbacks. Only the ones given appear (Rename, Move to, Delete); without them the page offers Download only. |

### Folders and what a key may do

A `read` key shows the view without write controls. A `read_write` key adds, once the offline outbox has loaded:

- **Add documents** and drag-and-drop upload; Rename, Move to and Delete on documents.
- **New folder** in the toolbar (an inline name form, Enter to create, Escape to cancel) and, on every folder card and list row, a `...` menu with **Rename**, **Move to…** and **Delete**. The header has the same menu for the current folder. The key's own folder cannot be renamed, moved or deleted (the API answers 403), so it has no menu.
- A name already taken in that folder shows an inline error ("A folder named “X” is already there."). Delete asks: "Move "X" and everything in it to the Shelf trash? You can restore it in Shelf." Nothing is destroyed; Shelf's trash restores it.
- Folder changes are queued in the same outbox as document changes (see [Offline changes](#offline-changes)): they show at once with a pending pill and work offline.
- A folder you just created offline is a local folder until it syncs. It cannot be opened, uploaded into or moved into yet; it becomes a normal folder when the send succeeds.

Bulk select and the bulk bar are not rendered. `offline={{ outbox: false }}` on a `ShelfProvider` hides all the write controls for a `read_write` key.

Folder cards and the header take their document counts from the folder listing (`item_count` / `total_item_count`) when the API sends them. Otherwise they count documents by reading every document under the key's folder once (up to 1000); over that, or if that read fails, the counts are left out rather than guessed. A document card shows `SIZE · TYPE`, plus pages or words when the API sends `parsed_meta` for the list (today only the single-document route does, so the Details panel shows them and the card does not).

### Visual parity

Rendered in Chromium (Playwright) from the built `dist/` against a fake API serving the real integration shapes, with a deliberately hostile host stylesheet (global `* { box-sizing: content-box !important }`, styled `h1`-`h3`, `button`, `a`, `li`, `svg`, a body font, `text-transform` and `letter-spacing`). With and without that stylesheet the component renders pixel-identical (at most 2 of about 2 million pixels differ), and the host's own elements compute to the same styles with and without the SDK loaded.

| Root folder, Gallery | Root folder, List |
| --- | --- |
| ![Root folder, Gallery](docs/screenshots/root-gallery-1280.png) | ![Root folder, List](docs/screenshots/root-list-1280.png) |
| Folder with a document, Gallery | Folder with a document, List |
| ![Folder with a document, Gallery](docs/screenshots/contracts-gallery-1280.png) | ![Folder with a document, List](docs/screenshots/contracts-list-1280.png) |

More in `docs/screenshots/`: the document page, a 900 px wide layout (`*-900.png`), the same views under hostile host CSS (`*-hostile.png`), and `target-equivalent-root-gallery.png`, the root view framed like the Shelf web screenshot it was compared with. The screenshots are not part of the npm package (`files` lists only `dist` and `README.md`).

Known differences from Shelf web's folder view, all because the integration API has no matching datum:

- The breadcrumb starts at the key's folder (`Aisle CMS`); web shows the shelf name before it (`Aisle CMS / Aisle CMS`), and the API does not give the shelf's name.
- Folder and header counts (`1 ITEM`, `1 ITEM · 5 FOLDERS`) come from the folder listing when the API sends counts, and are derived by reading the documents once when it does not.
- The page padding and scrollbar of Shelf web's app shell belong to the host page, not the component.

Reproduce: `cd harness && npm install && npx playwright install chromium && npm run build && npm run shoot`. The harness is dev only and is not in the package.

### Long names

File and folder names are handled the way Shelf web handles them (rules copied from web's `global.css`; the synced `src/styles/view.css` carries them): card, folder-tile and list names use `overflow-wrap: break-word` and are never clamped, so a long name makes its card or row taller; flex and grid containers that hold a name carry `min-width: 0`; folder-tree names are one line with an ellipsis; breadcrumbs do not wrap (`nowrap` plus an ellipsis). Gallery rows are as tall as the tallest card measured so far at that width; list rows are measured one by one, so rows of different height stay correctly placed while scrolling (perf `--strict` with long names in 1 of 5 documents: CLS 0, 0 long tasks).

Deliberate differences from web, each because the SDK's markup differs, not because the rule does:

- The card title and the list name are `<button>`s (navigation stays inside the embed), web's are `<a>`s. A button is an atomic inline: `break-word` does not shrink it, so an unbroken name would stay one long line. `overflow-wrap: anywhere` is set on those two elements only.
- The breadcrumb ellipsis rule web applies only on the document page is applied to every crumb row. On web's shelf page an unbroken folder name overflows the column at 375 px.
- The document header's `Back to <folder>` button ends in an ellipsis instead of taking the title's column (web has a breadcrumb there).
- Gallery rows share one height (the tallest card), where web's CSS grid sizes each row on its own. Web's selection checkbox and its status pill colours are not in the SDK.

`docs/screenshots/wrap-compare-*.png` set web (its Vite dev server, api mocked with Playwright route interception) beside the SDK at the same grid width; `wrap-compare.txt` lists the computed-style differences. Reproduce: `cd harness && node shelf-compare.mjs` (needs a Shelf web checkout with dependencies at `../../shelf/web`, or `SHELF_WEB`). `node wrap.mjs` checks that no name overflows its container at 1280, 900 and 375 px, plain and under the hostile host stylesheet.

### Host CSS requirements

None beyond importing `@pj-slf-998231/sdk/styles.css` once. Every rule sits under `.shelf-sdk` and every class is prefixed `shelf-sdk__`, so the host's element and class rules cannot match the embed and the embed never styles the host (no `:root`, `html`, `body` or bare element selectors; `npm run check:dist` fails the build if one appears). Host rules on bare elements (`h3 { font: ... }`, `li { margin: ... }`, `svg { fill: ... }`) do reach the embed's own elements, so `base.css` resets those that matter. Give it a container with a width: it fills its parent. It uses viewport media queries (720px and below stacks the layout), like Shelf web.

Theming and the token list: see [Tokens](#tokens) and [Theming](#theming). With per-entry stylesheets the same holds: each file's rules sit under `.shelf-sdk` too.

### Fonts

Shelf web uses Geist, Geist Mono and Instrument Serif, loaded from Google Fonts. The SDK instead bundles the same three (Latin subset, `woff2`) in `dist/fonts/` and declares them in `styles.css` with relative `url()`s, which bundlers (Vite, webpack, Next) resolve and emit. No request leaves for a third party and no CSP exception is needed. The families are named `Shelf Geist`, `Shelf Geist Mono` and `Shelf Instrument Serif`, so they never replace a copy the host loads; if a font file cannot load, the stack falls back to `Geist`, `Geist Mono`, `Instrument Serif` if the host has them, then system fonts.

Licences: all three are under the SIL Open Font License 1.1, which allows bundling and redistribution. The licence texts ship in `dist/fonts/` (`Geist-LICENSE.txt`, `Geist-Mono-LICENSE.txt`, `Instrument-Serif-LICENSE.txt`); the files come from the `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` and `@fontsource/instrument-serif` packages (dev dependencies).

## Local-first cache

`<ShelfFolder>` shows what it already knows first and revalidates in the background (stale-while-revalidate), so a folder you have opened before appears at once and keeps working without a network.

What is cached: the key info, the folder list, each viewed folder's document listing, document details, and thumbnails (small, medium, large; revalidated with `ETag` / `If-None-Match`, so an unchanged thumbnail costs a 304). The JSON routes are never cached by the browser (`no-store`); this cache is the SDK's own.

Limits (`DEFAULT_LIMITS` in `src/internal/contracts.ts`; least recently used is evicted first):

| Limit | Value |
| --- | --- |
| Thumbnails in total | 25 MiB |
| One thumbnail | 2 MiB |
| Everything (entries and thumbnails) | 50 MiB |
| One JSON entry | 1.5 MiB (over that a document's text is dropped first, then the entry is not stored) |
| Age | 30 days |

**Host checklist.** Three rules for every host, whether it uses `ShelfFolder` or the parts:

1. **Pass `cacheScope`**: a stable, non-secret id of who is signed in, such as the user id. It is what lets the SDK keep browsing and queued changes on the device for that user and keep them apart from the next one. Without it nothing persists and a queued upload is lost on reload.
2. **Call `clearCache()` on sign-out**, before the next user can use the browser.
3. **Do not gate the embed on `navigator.onLine`** or any host `online` flag. Mount it always: offline handling is built in (it shows what it has cached, queues changes and sends them when the network is back, with an offline banner), and a host that unmounts it while offline throws that away.

**`cacheScope` and why the default is memory-only.** Data is written to IndexedDB only when the host passes `cacheScope`, a string that identifies who is signed in (a user or tenant id). Without it, or with `cacheScope={false}`, the cache lives in memory and nothing is stored on the device. The SDK cannot know who is signed in or when they sign out, and stored documents outlive a session; so persisting is the host's decision, and it should pass a scope that changes with the user.

```tsx
<ShelfFolder baseUrl="/api/shelf" cacheScope={session.userId} onAuthLost={() => router.push('/login')} />
```

Security:

- Data is namespaced by `sha256(absolute baseUrl + NUL + cacheScope)` (32 hex characters). The scope is hashed into the namespace; the raw scope is never stored, and the folder key never reaches the browser and is never stored. Two scopes never see each other's data.
- `clearCache()` removes the stored data. `import { clearCache } from '@pj-slf-998231/sdk'`; call it on sign-out. With no argument it empties the in-page caches and deletes the whole `shelf-sdk` database, queued offline changes included; `clearCache({ baseUrl, cacheScope })` empties only that scope's cached entries and thumbnails and leaves its queued offline changes alone. It never rejects.
- `onAuthLost(error)` runs once when a request fails with a `401` or the proxy's `503 not_configured` (the key was revoked or removed). Before it runs, the cache for that scope is purged (and the queued changes are discarded; the view says how many). A `502`, a plain `503` or a network error means offline, not a lost key: the cache is kept and the view shows what it has.

## Offline changes

With a `read_write` key, Rename, Move to, Delete and uploads work offline, and so do **New folder** and a folder's Rename, Move to and Delete. Each change is applied to the view straight away and put in an outbox, which sends it when the browser is back online:

- **Pending**: waiting to be sent (a banner counts them: "You're offline. 3 changes will be sent when you're back online."). Failed sends are retried with exponential backoff, 1 s up to 60 s, 8 attempts.
- **Failed**: gave up after the retries (or the server refused). The item shows **Retry** and **Discard**.
- **Conflict**: the document changed on the server after you queued your change. Nothing is overwritten silently: the item shows **Keep mine** (send it anyway) and **Discard** (drop the change and show the server's version).
- **Delete** moves the document (or the folder with everything in it) to the Shelf trash, where it can be restored; deleting something already gone counts as done.
- **Folders**: the API has no idempotency key for creating a folder, so a create whose answer was lost and is sent again finds the same-named sibling and counts as done. A folder the server refuses (403) fails for good; a rename or move that finds the folder gone or changed is a conflict. A folder created offline has a local id and cannot be opened, uploaded into or moved into until it is synced; changes made to it while it is local are folded into its create.
- **Uploads** carry a client-generated id (`client_ref`), so a send that is repeated after a lost response cannot create a duplicate. Draining happens once even with several tabs open (`navigator.locks`, with a claim in IndexedDB as the fallback).
- **`durable: false`**: with a `cacheScope` the outbox is stored in IndexedDB and survives a reload. An upload over **25 MiB per file** (or beyond 100 MiB queued in total) is kept in memory only; it is sent while the tab lives but lost on reload (the outbox reports such an entry with `durable: false`). Without a `cacheScope` the whole outbox is memory-only.

## Performance

`harness/perf.mjs` drives Chromium (Playwright 1.64, headless) against a fake API with 5000 documents (`/api/shelf5k`, 200 per page, thumbnails for two thirds), viewport 1280x800, DPR 1, on an Apple M4 / macOS 26. Run it with `cd harness && npm ci && npx playwright install chromium && (cd .. && npm run build) && node build.mjs && node perf.mjs`; it exits 1 when a target is missed.

| Measure | Target | Result |
| --- | --- | --- |
| Warm first paint of the visible window (cache filled, API delayed 300 ms, median of 5) | < 100 ms | **27.1 ms** (27.5, 27.1, 26.5, 27.0, 27.6; 30 cards) |
| Cold first paint (nothing cached, API not delayed, median of 5) | none | 51.6 ms (51.2 to 51.9) |
| Most cards in the DOM during a full scroll through 5000 documents (Gallery) | <= 150 | **50** |
| Long tasks over 50 ms during that scroll | 0 | **0** (longest: none recorded) |
| 95th percentile frame interval during that scroll | <= 20 ms | **16.8 ms** |
| Cumulative layout shift (load plus scroll) | < 0.01 | **0** |
| Offline run: rename, upload, delete queued offline, then online | each sent once | 0 requests offline, then 1 PATCH, 1 POST, 1 DELETE |

First paint runs from `performance.mark('sdk-mount')`, just before React renders, to the double `requestAnimationFrame` after the first document card appears (found with a `MutationObserver`). The warm case can only be served from IndexedDB because the API answers 300 ms late; the cold case shows the network-free cost of the same path. The scroll is continuous, 40 px per frame (about 2400 px/s), through all 25 pages (about 270 000 px).

The List layout is measured the same way: 28 rows at most in the DOM, 0 long tasks, p95 frame 16.7 ms and, since 0.4.0, a CLS of **0** (it was 0.053 in 0.3.0, when the table's automatic column layout re-measured the columns as rows with different content widths scrolled in and out; the list table now uses `table-layout: fixed`). `perf.mjs --strict` gates the exit status on every target.

Visual parity with 0.2.0: `harness/compare.mjs` compares the 21 evidence screenshots of the 0.2.0 build against this one pixel by pixel. All 21 are identical (0 differing pixels), and the isolation checks (component pixels with and without hostile host CSS, host elements unchanged by the SDK) still show 0 differing pixels.

## Bundle size

Gzipped, minified, `react` and `react-dom` external, measured by `scripts/size-budget.mjs` (initial = the entry and the chunks it imports statically; lazy chunks load when used). The per-entry numbers are in the [entry table](#entry-points). The budgets in `scripts/entries.mjs` are the measured size plus 5%, each ceiling above the 0.4 plan carrying a comment with its reason; `./react` and `{ShelfFolder}` stay at 34.0 kB and the lazy total at 19.7 kB.

| | 0.2.0 | 0.3.0 | 0.4.0 | Budget |
| --- | ---: | ---: | ---: | ---: |
| Client (`@pj-slf-998231/sdk`), initial | 1.03 kB | 1.47 kB | 1.57 kB | 1.66 kB |
| React (`@pj-slf-998231/sdk/react`, `ShelfFolder` alone), initial | 9.88 kB | 30.00 kB | 33.84 kB | 34.0 kB |
| Lazy chunks (loaded on demand), total | none (all in the initial bundle) | 10.29 kB | 19.62 kB | 19.7 kB |

The lazy chunks at 0.4.0 are the outbox (5.94 kB, loaded only for `read_write` keys), the document-site renderer (7.07 kB), the document page (4.40 kB), the thumbnail loader (1.23 kB), the folder tree (1.37 kB), the rename/move/delete dialogs (1.17 kB), the folder census (0.43 kB) and `clearCache` (0.35 kB). The 0.3 total counted only the first level of lazy chunks; the document-site renderer behind the document page is counted since 0.4.0 (about 7 kB of the increase), the rest is the folder write UI and the outbox's folder operations.

`ShelfFolder` grew from 30.0 to 33.8 kB: the folder write UI (menus, the inline name form, validation, the outbox's folder operations; about 1.3 kB), the session and hook layer the standalone parts share, and the document page's `documentTabs` and keyboard handling. About 10.4 kB of the React entry is the virtual list engine (`@tanstack/react-virtual` and `@tanstack/virtual-core`), which is what keeps at most 50 cards in the DOM for 5000 documents; it is a real cost for a folder with a handful of documents, and the reason the smaller entries exist: a page that needs only a folder card or a client does not pay for it.

## Upgrading from 0.3 to 0.4

**No breaking changes.** Everything 0.3 exported is still exported with the same behaviour: `createShelfClient`, `isAuthLost`, `isOfflineError`, `ShelfError`, `clearCache`, the types, `ShelfFolder` and its props, and `@pj-slf-998231/sdk/styles.css`. 0.3 code builds and renders without a change. What is new:

- Hooks, standalone components and a `ShelfProvider`, each on its own subpath, with per-entry stylesheets (`css/<entry>.css`). See [Use only what you need](#use-only-what-you-need).
- Folder writes for `read_write` keys: `createFolder`, `updateFolder` and `deleteFolder` on the client, and New folder, Rename, Move to and Delete in `ShelfFolder`. If your proxy allowlist is the 0.3 one, add the folder routes (see the [route table](#server-side-proxy-recipe)). To keep a `read_write` key read-only in the embed, pass `offline={{ outbox: false }}` to a `ShelfProvider`.
- `ShelfFolder` props `documentId`, `initialDocumentId`, `onNavigate`, `showPreviewSizes` and `documentTabs`.
- The default theme is `light` (0.3.x followed the OS, so a light host could show a dark embed to dark-mode visitors). Pass `theme="auto"` to keep the old behaviour.
- The List layout uses `table-layout: fixed`, so scrolling it no longer shifts the layout (CLS 0, was 0.053).

Deprecations: none. Three things every host should do (the first two were advice in 0.3): pass `cacheScope`, call `clearCache()` on sign-out, and do not gate the embed on `online` (see the [host checklist](#local-first-cache)).

## Service worker interplay

If the host registers a service worker, it should leave `/api/*` alone (or whichever path the proxy lives on): do not answer those requests from a cache and do not add caching headers. The SDK does its own caching, with its own invalidation (`ETag` revalidation for thumbnails, stale-while-revalidate for the JSON routes) and its own offline handling; a service worker that serves a stale `/api/shelf/files` response hides changes and defeats the revalidation. Aisle's service worker already skips `/api/*`. If yours caches the app shell only, no change is needed.

## Data stored on this device

Only when the host passes `cacheScope`:

- **What**: the cached key info, folder list, document listings and details (names, types, sizes, extracted text of opened documents), thumbnails, and the queued offline changes (including the bytes of files waiting to upload). Never the folder key or the raw `cacheScope`.
- **Where**: one IndexedDB database named `shelf-sdk` in the host's origin, with the stores `entries`, `blobs` and `outbox`, keyed by the hashed namespace. Cross-tab updates travel over a `BroadcastChannel`. The Gallery/List and folder-tree choices are in `localStorage` (`shelf-sdk.layout`, `shelf-sdk.folderTree`, `shelf-sdk.docDetails`), with or without a scope.
- **How to clear it**: `await clearCache()` (all) or `await clearCache({ baseUrl, cacheScope })` (one scope), on sign-out; the user can also clear the site's data in the browser. It is cleared automatically when the key is revoked (`onAuthLost`) and entries older than 30 days are dropped. `clearCache()` with no argument also deletes queued offline changes; the scoped form keeps them.

## Development

```sh
npm ci
npm run typecheck && npm test && npm run build && npm run check:dist && node scripts/check-css.mjs && node scripts/check-entries.mjs && node scripts/check-imports.mjs && node scripts/size-budget.mjs && node scripts/check-treeshake.mjs
npm run check:docs      # every token in styles.css is in the README table; the README examples type-check against dist
npm run check:example   # examples/folder-card-only: size ceiling and no document page / virtual list / document site / outbox
npm run parts           # the standalone-CSS proof in Chromium (needs the harness dependencies)
```

The harness (`harness/`, dev only, not in the package) has its own dependencies: `cd harness && npm ci && npx playwright install chromium`. Then `node build.mjs` bundles the demo page, `node shoot.mjs <dir>` writes the evidence screenshots, `node compare.mjs <dirA> <dirB>` prints the differing pixels per PNG, and `node perf.mjs` runs the performance scenarios, `node theme.mjs` checks the theme defaults on a light host with a dark OS (the embed must stay light unless `theme` says otherwise).

Refresh the design tokens and the folder view's CSS from Shelf web:

```sh
npm run sync-tokens -- path/to/shelf/web/src/styles/tokens.css
# default: $SHELF_WEB_TOKENS, then ../shelf/web/src/styles/tokens.css
npm run sync-web-css -- path/to/shelf/web/src/styles/global.css
# default: $SHELF_WEB_GLOBAL_CSS, then ../shelf/web/src/styles/global.css; set SHELF_WEB_COMMIT to record the commit
```

`src/styles/styles.css` and `src/styles/view.css` are generated; edit `base.css`, `fonts.css` and `extras.css` by hand. The per-entry files in `dist/css/` are derived from them at build time by `scripts/split-css.mjs`.

## Release

Releases are automatic. Every merge to `main` that changes a publishable file (`src/**`, `package.json`, `package-lock.json`, `tsup.config.ts`, `tsconfig.json`, `scripts/entries.mjs`, `scripts/split-css.mjs`, `README.md`, `LICENSE`) runs `.github/workflows/release.yaml`: it runs the whole CI workflow as a gate, then works out the next version, publishes it to npmjs.org with `npm publish --provenance --access public`, pushes the tag `vX.Y.Z` at the merge commit and creates a GitHub release with generated notes. Nothing is committed back to `main`; the version is set only in the runner.

The version comes from `scripts/next-version.mjs`, from the commits since the latest `v*` tag. Any line of a commit message (a merge commit carries the PR title in its body) counts:

- `BREAKING CHANGE` or a `type!:` prefix (`feat!:`, `fix(react)!:`) gives a major release.
- `feat:` or `feat(scope):` gives a minor release.
- Anything else gives a patch release.

To force a particular version, raise `version` in `package.json` above the latest tag: that exact version is released. So `package.json` is a floor, not the source of the published version; between releases it can lag behind the tags. Run `node scripts/next-version.mjs --dry-run` to see the latest tag, the commits considered and the decision.

To skip a release: changes only to docs, tests, examples or CI do not match the paths above and never trigger one. A commit with `[skip release]` in its message is not counted, and when no counted commits remain since the tag nothing is released. The workflow can also be run by hand (`workflow_dispatch`); it releases only if there is something to release. A rerun after a partial failure is safe: a version already on npm is not published again, and an existing tag or release is reused.

One-time setup: the repository secret `NPM_TOKEN` (an npm automation token that can publish the package), and Settings, Actions, General, Workflow permissions must allow the workflow to write (the job asks for `contents: write` to push the tag and create the release). If tag or branch rulesets are added, allow `github-actions` to create `v*` tags.
