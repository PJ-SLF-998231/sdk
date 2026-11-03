# Changelog

Notable changes to `@pj-slf-998231/sdk`. Versions follow semver; each one is released by its `vX.Y.Z` tag (see the
README, "Release"). Entries before 0.4.0 were written after the fact from the git history and the README of each tag.

## Unreleased

### Changed

- Published publicly on npm (MIT, with provenance) instead of GitHub Packages; install is a plain `npm install`.
- README: the server-side proxy recipe forwards `Content-Length` and `If-Range` and passes `Content-Range`,
  `Accept-Ranges`, `Vary`, `X-Content-Type-Options` and `Retry-After` back, explains `ETag` / `304`, and is the same
  recipe as `@pj-slf-998231/sdk-react-native`'s.
- README: "Create a key" follows Shelf web's Integrations dialog (Platform, Read only / Read and manage, expiry) and says
  the `folder_integrations` flag must be on.

## 0.4.0 - 2026-10-30

No breaking changes; 0.3 code builds and renders unchanged.

### Added

- Hooks (`useFolders`, `useFolder`, `useDocument`, `useDocumentText`, `useDocumentSite`, `useUpload`, `useOutbox`,
  `useOnlineStatus`, `useDocumentActions`, `useFolderActions`, `useShelf`), `ShelfProvider` and standalone components
  (`FolderCard`, `FolderGrid`, `FolderHeader`, `FolderToolbar`, `ViewToggle`, `UploadDropzone`, `DocumentCard`,
  `DocumentGallery`, `DocumentList`, `DocumentPage`, `OfflineBanner`, `ActionMenu`, `FolderTree`), each on its own
  subpath with its own stylesheet (`css/<entry>.css`).
- Folder writes for `read_write` keys: `createFolder`, `updateFolder` and `deleteFolder` on the client and the outbox,
  and New folder, Rename, Move to and Delete in `ShelfFolder`. Proxies need the three folder routes.
- `ShelfFolder` props `documentId`, `initialDocumentId`, `onNavigate`, `showPreviewSizes` and `documentTabs`.
- Per-entry size budgets, entry and import checks, and README examples type-checked against the build
  (`check:readme`).

### Changed

- The default theme is `light` (0.3 followed the OS). Pass `theme="auto"` for the old behaviour.
- The List layout uses `table-layout: fixed`: a CLS of 0 (0.053 in 0.3.0).
- Long file and folder names wrap or ellipsize by Shelf web's rules and never overflow.
- vitest 5, vite 8 and esbuild 0.28 (npm audit findings).

## 0.3.0 - 2026-10-30

### Added

- Local-first cache in IndexedDB (stale-while-revalidate, cross-tab updates, thumbnails) and `clearCache()`.
- An offline outbox for `read_write` keys, loaded lazily: uploads, renames, moves and deletes queue offline and are
  sent when back online, with an explicit Keep mine / Discard choice on a conflict. `isAuthLost` and `isOfflineError`.
- A virtualised gallery and list (at most about 50 cards in the DOM for 5000 documents).
- The document page with Text, Preview and Content (the document's generated site) tabs, ported from Shelf web;
  `getSite` on the client.
- A performance harness with a 5000-document fake API, and split-aware size budgets.

## 0.2.0 - 2026-10-29

### Changed

- `<ShelfFolder>` renders Shelf web's own folder view, ported from its source: header with folder-tree toggle,
  breadcrumb and counts, Gallery/List toggle, folder and document cards or rows with status pills, drag-and-drop upload
  and a document page. Its CSS is generated from Shelf web's and scoped under `.shelf-sdk`; Geist, Geist Mono and
  Instrument Serif are bundled.
- Host CSS on bare elements no longer reaches into the embed.

### Added

- A dev-only Playwright harness with screenshots and a pixel-diff isolation check.

## 0.1.2 - 2026-10-29

### Fixed

- Delete says what it does: the document moves to the Shelf trash and can be restored there.

## 0.1.1 - 2026-10-29

### Fixed

- Read the API's `{ files }` listing, tolerate `null` lists, and treat preview sizes as names.

## 0.1.0 - 2026-10-28

### Added

- The framework-free client (`createShelfClient`) for `/api/v1/integration`.
- `<ShelfFolder>`, a React UI to browse, open, upload, rename, move and delete the documents in one folder, with
  Shelf's tokens scoped to the component.
- Publishing to GitHub Packages from a version tag.
