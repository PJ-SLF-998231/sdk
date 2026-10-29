# @pj-slf-998231/sdk

Client and React UI for the Shelf folder integration API (`/api/v1/integration`).
Two parts, one package:

- A framework-free TypeScript client (`createShelfClient`).
- A React component (`<ShelfFolder>`) that renders Shelf web's own folder view, ported from its source: header with folder-tree toggle, breadcrumb and counts, Gallery/List toggle, folder cards, document cards or rows, drag-and-drop upload and the document page. It browses, opens, uploads, renames, moves and deletes the documents in one folder.

The package is private, published to GitHub Packages under the `@pj-slf-998231` scope.

## Install

Add an `.npmrc` next to your `package.json`. The token comes from the environment; never commit it.

```ini
@pj-slf-998231:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Export a GitHub token with `read:packages` (a personal access token locally, `GITHUB_TOKEN` or a PAT in CI), then install:

```sh
export NODE_AUTH_TOKEN=<token with read:packages>
npm install @pj-slf-998231/sdk
```

`react` and `react-dom` (>= 18) are optional peer dependencies, needed only for `@pj-slf-998231/sdk/react`.

## Security model

A folder key (`shelf_ik_...`) is a bearer credential for one Shelf folder, read-only or read_write.

- The key must never reach a browser: not in a bundle, not in a request, not in a cookie. Keep it in server-side configuration (for example a Fly secret).
- Browser-direct use is unsupported. Browsers talk to your own server, which authenticates the user and adds the key.
- Revoking the key in Shelf makes every call fail; the proxy then answers `503 not_configured` and the UI shows a "not configured" state instead of data (fail closed).

## Create a key

In Shelf web, open the folder, open its integrations dialog and create a key. Choose `read` or `read_write`. The key is shown once; copy it into your server's secret store (for example `SHELF_INTEGRATION_KEY`). Set `SHELF_API_URL` to your Shelf API origin.

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

Methods: `info()`, `folders()`, `listFiles({ folder_id, limit, cursor, recursive })`, `getFile(id)`, `upload(blob, { folder_id, filename, client_ref, on_duplicate })`, `updateFile(id, { filename, folder_id })`, `deleteFile(id)`, `thumbnailUrl(id, size?)`, `originalUrl(id, filename)`. Failures throw `ShelfError` with `status`, `code` and optional `field`.

### Browser (through your proxy)

```ts
const shelf = createShelfClient({ baseUrl: '/api/shelf' }); // no apiKey
```

Requests are same-origin (`credentials: 'same-origin'`), so your session cookie authenticates the user and the proxy adds the key.

## Server-side proxy recipe

Mount a proxy at `/api/shelf/*` behind your own session check. It forwards to `${SHELF_API_URL}/api/v1/integration/<path>` and adds `Authorization: Bearer ${SHELF_INTEGRATION_KEY}`.

Route table (anything else: 404, do not forward):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | key and folder info |
| GET | `/folders` | folders reachable by the key |
| GET | `/files?folder_id&limit&cursor&recursive` | list |
| GET | `/files/{id}` | details and text |
| GET | `/files/{id}/thumbnail?size` | image preview |
| GET | `/files/{id}/original/{name}` | download; stream the body |
| POST | `/files` | multipart: `file`, `folder_id`, `client_ref`, `on_duplicate`; stream the body |
| PATCH | `/files/{id}` | rename or move (JSON) |
| DELETE | `/files/{id}` | delete |

Header allowlist. Forward only these and drop everything else, in particular the browser's `Authorization`, `Cookie` and `Host`.

- Request to Shelf: `Content-Type` (keeps the multipart boundary), `Accept`, `If-None-Match`, `Range`.
- Response to the browser: `Content-Type`, `Content-Length`, `Content-Disposition`, `Cache-Control`, `ETag`, `Last-Modified`.

Errors the proxy produces itself:

| Condition | Response |
| --- | --- |
| No valid user session | 401 (your own auth) |
| `SHELF_INTEGRATION_KEY` unset, or Shelf answers 401 (key revoked or invalid) | `503 {"code":"not_configured"}` (fail closed) |
| Shelf unreachable or times out | 502 |
| Method or path not in the route table | 404 |
| Other Shelf errors (400, 403, 404, 409, 413, 415, 429) | pass through status and JSON body |

Minimal Express sketch:

```ts
const ROUTES: [string, RegExp][] = [
  ['GET', /^\/?$/], ['GET', /^\/folders$/], ['GET', /^\/files$/],
  ['GET', /^\/files\/[^/]+$/], ['GET', /^\/files\/[^/]+\/thumbnail$/],
  ['GET', /^\/files\/[^/]+\/original\/[^/]+$/], ['POST', /^\/files$/],
  ['PATCH', /^\/files\/[^/]+$/], ['DELETE', /^\/files\/[^/]+$/],
];

app.use('/api/shelf', requireSession, async (req, res) => {
  if (!ROUTES.some(([m, re]) => m === req.method && re.test(req.path))) return res.sendStatus(404);
  const key = process.env.SHELF_INTEGRATION_KEY;
  if (!key) return res.status(503).json({ code: 'not_configured' });
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  for (const h of ['content-type', 'accept', 'if-none-match', 'range']) {
    if (req.headers[h]) headers[h] = String(req.headers[h]);
  }
  let up: Response;
  try {
    up = await fetch(`${process.env.SHELF_API_URL}/api/v1/integration${req.url}`, {
      method: req.method, headers,
      body: req.method === 'POST' || req.method === 'PATCH' ? (req as any) : undefined,
      duplex: 'half',
    } as RequestInit);
  } catch {
    return res.status(502).json({ code: 'bad_gateway' });
  }
  if (up.status === 401) return res.status(503).json({ code: 'not_configured' });
  res.status(up.status);
  for (const h of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified']) {
    const v = up.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  up.body ? Readable.fromWeb(up.body as any).pipe(res) : res.end();
});
```

## React usage

```tsx
import { ShelfFolder } from '@pj-slf-998231/sdk/react';
import '@pj-slf-998231/sdk/styles.css';

export function Files() {
  return <ShelfFolder baseUrl="/api/shelf" />;
}
```

Props: `baseUrl` or a ready `client`, `initialFolderId`, `theme` (`'light' | 'dark' | 'auto'`, default `auto` follows the OS), `className`.

### What it shows

The markup, class structure, CSS, tokens and icons are ported from Shelf web (`src/pages/ShelfPage.tsx`, `src/components/shelf/*`, `src/styles/global.css`, `tokens.css`), so the embed looks like Shelf's own folder view:

- Header row: a folder-icon button that opens the folder tree, the breadcrumb (ancestors muted, current folder bold), mono meta such as `1 ITEM · 5 FOLDERS`.
- Toolbar: **Add documents** (read_write keys only) and the **Gallery | List** toggle.
- A `FOLDERS` section of folder cards, a `DOCUMENTS` section of document cards (thumbnail, status pill, name, `SIZE · TYPE`), or in List mode a table of the same.
- A drop hint, `Drop documents here to add them to <folder> · PDF, Word, ...`. Dropping files anywhere on the view uploads them (read_write only).
- Click a document for the document page: type and size, filename, Text and Preview tabs, a Details panel, Download, and a Rename / Move to / Delete menu (read_write only). Delete moves the file to the Shelf trash; it can be restored in Shelf.
- A `503 not_configured` shows a "Shelf isn't connected" state.

The Gallery/List choice is remembered in `localStorage` (`shelf-sdk.layout`), and so is whether the folder tree is open (`shelf-sdk.folderTree`). If storage is unavailable (private windows, locked-down hosts) both still toggle, they are just not remembered.

### What it does not show

The folder view only offers what the integration API can do. It has no route to create, rename, move or delete folders, so the **New folder** button and the folder cards' and header's `...` menus are not rendered. Bulk select and the bulk bar are not rendered either. Documents get Rename, Move to and Delete.

Folder cards and the header count documents by reading every document under the key's folder once (up to 1000). Over that, or if that read fails, the counts are left out rather than guessed. A document card shows `SIZE · TYPE`, plus pages or words when the API sends `parsed_meta` for the list (today only the single-document route does, so the Details panel shows them and the card does not).

### Host CSS requirements

None beyond importing `@pj-slf-998231/sdk/styles.css` once. Every rule sits under `.shelf-sdk` and every class is prefixed `shelf-sdk__`, so the host's element and class rules cannot match the embed and the embed never styles the host (no `:root`, `html`, `body` or bare element selectors; `npm run check:dist` fails the build if one appears). Give it a container with a width: it fills its parent. It uses viewport media queries (720px and below stacks the layout), like Shelf web.

Theming: tokens are CSS custom properties on `.shelf-sdk` (`--bg`, `--fg`, `--accent`, `--line`, ...). Override one on `.shelf-sdk` (or via `className`), or set `theme` to force light or dark.

### Fonts

Shelf web uses Geist, Geist Mono and Instrument Serif, loaded from Google Fonts. The SDK instead bundles the same three (Latin subset, `woff2`) in `dist/fonts/` and declares them in `styles.css` with relative `url()`s, which bundlers (Vite, webpack, Next) resolve and emit. No request leaves for a third party and no CSP exception is needed. The families are named `Shelf Geist`, `Shelf Geist Mono` and `Shelf Instrument Serif`, so they never replace a copy the host loads; if a font file cannot load, the stack falls back to `Geist`, `Geist Mono`, `Instrument Serif` if the host has them, then system fonts.

Licences: all three are under the SIL Open Font License 1.1, which allows bundling and redistribution. The licence texts ship in `dist/fonts/` (`Geist-LICENSE.txt`, `Geist-Mono-LICENSE.txt`, `Instrument-Serif-LICENSE.txt`); the files come from the `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` and `@fontsource/instrument-serif` packages (dev dependencies).

## Development

```sh
npm ci
npm run typecheck && npm test && npm run build && npm run check:dist
```

Refresh the design tokens and the folder view's CSS from Shelf web:

```sh
npm run sync-tokens -- path/to/shelf/web/src/styles/tokens.css
# default: $SHELF_WEB_TOKENS, then ../shelf/web/src/styles/tokens.css
npm run sync-web-css -- path/to/shelf/web/src/styles/global.css
# default: $SHELF_WEB_GLOBAL_CSS, then ../shelf/web/src/styles/global.css; set SHELF_WEB_COMMIT to record the commit
```

`src/styles/styles.css` and `src/styles/view.css` are generated; edit `base.css`, `fonts.css` and `extras.css` by hand.

## Release

Releases are by tag. Set `version` in `package.json`, merge, then push a matching semver tag `vX.Y.Z`. `.github/workflows/release.yaml` runs typecheck, tests, build and `check:dist`, verifies the tag equals the package version, and runs `npm publish` to GitHub Packages with the workflow's `GITHUB_TOKEN`.
