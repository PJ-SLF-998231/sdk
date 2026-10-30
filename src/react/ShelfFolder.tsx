import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isAuthLost, isOfflineError } from '../client';
import type { ShelfClient, ShelfError } from '../client';
import { useFolderListing } from '../hooks/useFolderListing';
import { useOnline } from '../hooks/useOnline';
import { useOutbox } from '../hooks/useOutbox';
import { useResource } from '../hooks/useResource';
import type { ShelfFolder as FolderRecord, ShelfInfo, ShelfItem } from '../types';
import type { Pending } from './ActionDialog';
import { ShelfContext } from './context';
import type { DocumentTabId, FolderLayout, ShelfSource, ShelfTheme } from './contracts';
import { cx } from './cx';
import { VirtualGallery } from './documents/VirtualGallery';
import type { VirtualGalleryProps } from './documents/VirtualGallery';
import { FolderRow, FolderRowsTable, VirtualTable } from './documents/VirtualTable';
import { FolderCard } from './folder/FolderCard';
import { Header } from './folder/Header';
import { FolderToolbar } from './folder/FolderToolbar';
import { placesOf } from './folder/places';
import { FolderSidebar } from './folder/FolderSidebar';
import { ActionDialogPart, DocumentPagePart, docFallback, dialogFallback, FolderDialogPart, FolderTreePart } from './folder/lazyParts';
import { LAYOUT_KEY, readStore, TREE_KEY, writeStore } from './folder/store';
import { Zone } from './folder/Zone';
import { useSelectedDocument } from './folder/useSelectedDocument';
import { LOCAL_FOLDER_PREFIX } from './folder/folderOps';
import { useFolderEditor } from './folder/useFolderEditor';
import { describe, NO_EDITS, useFolderWrites } from './folder/useFolderWrites';
import { plural, UPLOAD_LIMITS } from './format';
import { useFoldersOf } from './hooks/useFolders';
import { mergeSame } from './provider/merge';
import { OfflineBanner } from './standalone/OfflineBanner';
import { NotConnected, ShelfRoot } from './ShelfRoot';
import type { Detail } from './DocumentPage';
import type { ItemAction } from './syncUi';
import { useShelfSessionState } from './useShelfSession';
import type { ShelfSessionState } from './useShelfSession';

export { LAYOUT_KEY, TREE_KEY };

export interface ShelfFolderProps {
  /** A ready client. Takes precedence over `baseUrl`; without either the nearest ShelfProvider's is used. */
  client?: ShelfClient;
  /** Integration API base URL (for example a same-origin proxy such as /api/shelf). */
  baseUrl?: string;
  /** Folder to open first, and the top of the breadcrumb. Defaults to the key's folder. */
  initialFolderId?: string;
  /** `light` (default), `dark`, or `auto` to follow the OS colour scheme. Only an explicit `auto` follows the OS, so a light-only host never shows a dark embed. */
  theme?: ShelfTheme;
  className?: string;
  /**
   * Keep listings, details and thumbnails on this device (IndexedDB) so the view opens instantly and works
   * offline. Pass a string that identifies who is signed in (a user or tenant id): caches never mix between
   * scopes. Without it (the default) or with `false`, the cache lives in memory only and nothing is stored.
   */
  cacheScope?: string | false;
  /**
   * Called once when the session is no longer authorised (a 401, or the proxy's 503 `not_configured`).
   * The cache has been purged by then and the view shows "Shelf isn't connected".
   */
  onAuthLost?: (error: ShelfError) => void;
  /**
   * The document to show, controlled: a document id opens that document's page, `null` shows the folder.
   * Leave it out to let the component keep the state itself (see `initialDocumentId`). While it is set the host owns
   * the open document: update it from `onNavigate`.
   */
  documentId?: string | null;
  /** Document to open first when `documentId` is not controlled (a deep link). */
  initialDocumentId?: string;
  /**
   * Called when the user navigates inside the embed: opening a folder or a document, going back from one. A host
   * router can mirror it in the URL. `folderId` is the folder shown (or the document's folder); `documentId` is the open
   * document, or null.
   */
  onNavigate?: (target: { folderId: string | null; documentId: string | null }) => void;
  /** Show the Small / Medium / Large / Original bar over an image preview on the document page. Default true (or the ShelfProvider's). */
  showPreviewSizes?: boolean;
  /** Tabs of the document page and their order. Default ['text', 'preview', 'content'] (or the ShelfProvider's). */
  documentTabs?: readonly DocumentTabId[];
}

const PAGE = 200;
const EMPTY_FOLDERS: FolderRecord[] = [];

/** A folder view: folders and documents, as a gallery or a list, with the document page, tree and (read_write) uploads. */
export function ShelfFolder({ client, baseUrl, cacheScope, onAuthLost, theme, className, ...view }: ShelfFolderProps) {
  const s = useShelfSessionState({ client, baseUrl, cacheScope, onAuthLost }, true);
  const body = !s.client || s.lost ? <NotConnected discarded={s.discarded} /> : s.session ? <FolderView key={view.initialFolderId ?? ''} s={s} {...view} /> : null;
  return (
    <ShelfRoot theme={theme} className={className}>
      {body}
    </ShelfRoot>
  );
}

type ViewProps = Omit<ShelfFolderProps, keyof ShelfSource | 'theme' | 'className'> & { s: ShelfSessionState };
type Row = NonNullable<VirtualGalleryProps['items']>[number];

function FolderView({ s, initialFolderId, documentId, initialDocumentId, onNavigate, showPreviewSizes, documentTabs }: ViewProps) {
  const defaults = useContext(ShelfContext);
  const session = s.session!;
  const client = session.client;
  const swr = s.swr;
  const loader = session.parts?.loader ?? null;

  const infoRes = useResource<ShelfInfo>(swr, useMemo(() => (swr ? { key: 'info', merge: mergeSame, fetcher: (signal: AbortSignal) => client.info({ signal }) } : null), [swr, client]));
  const { folders: model, outbox, loaded } = useFoldersOf(s);
  const folders = loaded ? model.folders : EMPTY_FOLDERS;
  const ready = infoRes.data !== undefined && loaded;

  // The top of the breadcrumb is decided once, when the folders first arrive.
  const [rootId, setRootId] = useState<string | null | undefined>(undefined);
  if (rootId === undefined && ready) setRootId(initialFolderId ?? model.rootId);
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const currentId: string | null = chosen !== undefined ? chosen : (rootId ?? null);
  const open = ready && rootId !== undefined;
  const currentRef = useRef(currentId);
  currentRef.current = currentId;

  // The open document: the host's when it passes `documentId`, else kept here (opened first from `initialDocumentId`).
  const [innerDocId, setInnerDocId] = useState<string | null>(initialDocumentId ?? null);
  const controlled = documentId !== undefined;
  const selectedId = controlled ? documentId : innerDocId;
  const latest = useRef({ controlled, onNavigate });
  latest.current = { controlled, onNavigate };
  const setSelectedId = useCallback((id: string | null) => {
    if (!latest.current.controlled) setInnerDocId(id);
  }, []);
  const notify = useCallback((folderId: string | null, docId: string | null) => latest.current.onNavigate?.({ folderId, documentId: docId }), []);
  const [pending, setPending] = useState<Pending | null>(null);

  const online = useOnline();
  const canWrite = !!outbox; // write controls appear once the (lazily loaded) outbox is there to take the change; only read_write keys have one
  const outboxView = useOutbox(outbox);
  const listing = useFolderListing(open ? swr : null, open ? client : null, { folderId: currentId, recursive: false, pageSize: PAGE });
  const refreshListing = useRef(listing.refresh);
  refreshListing.current = listing.refresh;
  const { refresh: refreshFolders } = model;
  const w = useFolderWrites({
    session,
    outbox,
    currentId,
    currentRef,
    selectedId,
    setPending,
    closeDocument: () => {
      setSelectedId(null);
      notify(currentRef.current, null);
    },
    onApplied: () => {
      void refreshFolders();
      void refreshListing.current();
    },
  });
  const { edits, landed } = w;
  const editorReset = useRef<() => void>(() => undefined);
  const go = useCallback(
    (id: string | null) => {
      if (id?.startsWith(LOCAL_FOLDER_PREFIX)) return; // a folder made offline cannot be opened until it has reached the server
      editorReset.current();
      setChosen(id);
      setSelectedId(null);
      notify(id, null);
      setPending(null);
      w.reset();
    },
    [setSelectedId, notify, w.reset], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const items = useMemo<Row[]>(() => {
    let base: ShelfItem[] = listing.items;
    if (edits !== NO_EDITS) base = base.filter((x) => !edits.removed.includes(x.id)).map((x) => (edits.patched[x.id] ? { ...x, ...edits.patched[x.id] } : x));
    if (landed.length > 0) {
      const have = new Set(base.map((x) => x.id));
      const extra = landed.filter((x) => !have.has(x.id) && (x.folder_id ?? null) === currentId && !edits.removed.includes(x.id));
      if (extra.length > 0) base = [...extra, ...base];
    }
    // Until the lazy outbox chunk has arrived the items render as they are.
    return (outbox && session.applyOutbox ? session.applyOutbox(base, outboxView.entries, currentId) : base) as Row[];
  }, [listing.items, edits, landed, outbox, session, outboxView.entries, currentId]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const { selected, res: detailRes } = useSelectedDocument(swr, client, selectedId, items, edits.patched, { enabled: open, currentRef, to: setChosen });

  const [layout, setLayoutState] = useState<FolderLayout>(() => (readStore(LAYOUT_KEY) === 'list' ? 'list' : 'grid'));
  const [treeOpen, setTreeOpen] = useState<boolean>(() => readStore(TREE_KEY) === 'open');

  const { totals } = model;
  const subfolders = model.childrenOf(currentId);
  const { crumbs, currentName, rootName, locationOf, captionOf } = placesOf(model, currentId, rootId);
  const hasFolders = rootId == null ? folders.length > 0 : folders.some((f) => f.id !== rootId);
  const editor = useFolderEditor({ outbox, folders: model.folders, keyRootId: s.rootFolderId ?? model.rootId, currentId, onRetry: w.onRetry, onDiscard: w.onDiscard, go });
  editorReset.current = editor.reset;

  // Fetch the lazily loaded parts while the browser is idle, so opening one does not wait for a chunk.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      DocumentPagePart.preload();
      ActionDialogPart.preload();
      if (canWrite) FolderDialogPart.preload();
      if (hasFolders) FolderTreePart.preload();
    }, 0);
    return () => clearTimeout(t);
  }, [ready, hasFolders, canWrite]);

  // Stable, so the memoised cards and rows skip re-rendering when something unrelated changes.
  const onOpen = useCallback(
    (id: string) => {
      if (id.startsWith('local:')) return; // an upload that has not landed has no document to open yet
      setSelectedId(id);
      notify(currentRef.current, id);
    },
    [setSelectedId, notify],
  );
  const onAction = useCallback((action: ItemAction, id: string) => {
    const item = itemsRef.current.find((x) => x.id === id);
    if (item) setPending({ kind: action, item });
  }, []);
  const { prefetchNext } = listing;
  const onNearEnd = useCallback(() => void prefetchNext(), [prefetchNext]);

  // What went wrong loading, other than being offline or signed out (those have their own handling).
  const pick = (err: unknown, action: string) => (err !== undefined && !isAuthLost(err) && !isOfflineError(err) ? describe(err, action) : null);
  const error =
    w.actionError ?? pick(infoRes.error, 'Could not load Shelf') ?? pick(model.error, 'Could not load Shelf') ?? pick(listing.error, 'Could not load files') ?? pick(detailRes.error, 'Could not load the document');
  const offline = infoRes.offline || model.offline || listing.offline || detailRes.offline;
  const addingCount = outboxView.entries.filter((e) => e.op.kind === 'upload' && (e.status === 'pending' || e.status === 'running')).length;

  // Nothing is known about this folder's documents until the first page (or the cache) answers.
  const listingKnown = listing.complete || listing.nextCursor !== null || listing.items.length > 0 || listing.error !== undefined;
  const listLoading = open && !listingKnown && items.length === 0 && subfolders.length === 0;
  const isEmpty = open && listingKnown && subfolders.length === 0 && items.length === 0 && !error && !editor.adding;
  const headerMeta = model.totalItems !== null ? `${plural(model.totalItems, 'item')} · ${plural(folders.length, 'folder')}` : folders.length ? plural(folders.length, 'folder') : '';

  const listProps = loader ? { items, loader, selectedId, canWrite, onOpen, onRetry: outbox ? w.onRetry : undefined, onDiscard: outbox ? w.onDiscard : undefined, onAction, onNearEnd } : null;
  // Keyed so the list re-measures where it starts when the content above it (the folders) changes.
  const listKey = `${currentId ?? ''}:${subfolders.length}`;
  const folderRows = subfolders.map((f) => <FolderRow key={`d-${f.id}`} folder={f} caption={captionOf(f)} onOpen={go} {...editor.rowProps(f)} />);
  const showing = layout === 'list' ? (
    <>
      {editor.newFolder(true)}
      {items.length > 0 ? listProps && <VirtualTable key={listKey} {...listProps} folderRows={folderRows} folderCount={subfolders.length} /> : listProps && <FolderRowsTable folderRows={folderRows} />}
    </>
  ) : (
    <>
      {(subfolders.length > 0 || editor.adding) && (
        <>
          <h2 className={cx('kicker', 'shelf-section-label')}>Folders</h2>
          <div className={cx('folder-grid')}>
            {editor.newFolder(false)}
            {subfolders.map((f) => (
              <FolderCard key={f.id} folder={f} caption={captionOf(f) ?? undefined} onOpen={go} {...editor.cardProps(f)} />
            ))}
          </div>
        </>
      )}
      {items.length > 0 && listProps && (
        <>
          <div className={cx('shelf-section-head')}>
            <h2 className={cx('kicker', 'shelf-section-label')}>Documents</h2>
          </div>
          <VirtualGallery key={listKey} {...listProps} />
        </>
      )}
    </>
  );
  const closeDocument = () => {
    setSelectedId(null);
    setPending(null);
    notify(currentId, null);
  };

  return (
    <>
      <div aria-live="polite">
        {error && (
          <p className={cx('callout', 'callout--danger')} role="alert">
            {error}
          </p>
        )}
        {outbox && <OfflineBanner online={online} waiting={outboxView.pending} />}
        {offline && ready && (
          <p className={cx('status-note')} role="status" data-testid="shelf-offline">
            You&apos;re offline. Showing the last saved copy.
          </p>
        )}
      </div>

      <div className={cx('shelf-layout', hasFolders ? (treeOpen ? '' : 'shelf-layout--rail') : 'shelf-layout--flat')}>
        {hasFolders && (
          <FolderSidebar
            open={treeOpen}
            onToggle={() => {
              setTreeOpen(!treeOpen);
              writeStore(TREE_KEY, treeOpen ? 'closed' : 'open');
            }}
            rootId={rootId ?? null}
            rootName={rootName}
            folders={folders}
            files={items}
            totals={totals as Map<string, number> | null}
            currentFolderId={currentId}
            currentFileId={selectedId}
            onOpenFolder={go}
            onOpenFile={(f) => {
              setSelectedId(f.id);
              notify(f.folder_id ?? null, f.id);
            }}
          />
        )}

        <section className={cx('shelf-main')} aria-label={`Contents of ${currentName}`}>
          <Header crumbs={crumbs} onNavigate={go} meta={headerMeta} documentOpen={!!selected} actions={editor.headerMenu} />

          {editor.panel}

          {pending && (
            <ActionDialogPart.Part
              key={`${pending.kind}:${pending.item.id}`}
              fallback={dialogFallback}
              pending={pending}
              folders={folders}
              busy={w.working}
              onRename={w.renameItem}
              onMove={w.moveItem}
              onDelete={w.deleteItem}
              onCancel={() => setPending(null)}
            />
          )}

          {selectedId ? (
            selected ? (
              <DocumentPagePart.Part
                key={selected.id}
                fallback={docFallback}
                client={client}
                swr={swr}
                loader={loader}
                doc={selected}
                location={locationOf(selected)}
                folderName={currentName}
                showPreviewSizes={showPreviewSizes ?? defaults?.showPreviewSizes}
                documentTabs={documentTabs ?? defaults?.documentTabs}
                onRename={canWrite ? () => setPending({ kind: 'rename', item: selected }) : undefined}
                onMove={canWrite ? () => setPending({ kind: 'move', item: selected }) : undefined}
                onDelete={canWrite ? () => setPending({ kind: 'delete', item: selected }) : undefined}
                onClose={closeDocument}
              />
            ) : (
              docFallback
            )
          ) : (
            <>
              <FolderToolbar
                canWrite={canWrite}
                onAddFiles={(files) => void w.upload(files)}
                onNewFolder={canWrite ? editor.startAdding : undefined}
                adding={addingCount}
                layout={layout}
                onLayoutChange={(next) => {
                  setLayoutState(next);
                  writeStore(LAYOUT_KEY, next);
                }}
              />
              <Zone accept={canWrite ? (files) => void w.upload(files) : null}>
                {!open || !loader || listLoading ? (
                  <p className={cx('status-note')} role="status">
                    {!ready && (infoRes.offline || model.offline) ? "You're offline. Shelf will load when the connection is back." : 'Loading...'}
                  </p>
                ) : isEmpty ? (
                  <div className={cx('empty', 'empty--inline')}>
                    <p className={cx('empty-title')}>This folder is empty.</p>
                    {canWrite && <p>Drag documents here to add them.</p>}
                    {canWrite && <p className={cx('dropzone-limits')}>{UPLOAD_LIMITS}</p>}
                  </div>
                ) : (
                  <>
                    {showing}
                    {listing.nextCursor && !listing.loadingMore && (
                      <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'more')} onClick={() => void listing.loadMore()}>
                        Load more
                      </button>
                    )}
                    {canWrite && (
                      <p className={cx('dropzone-limits', 'shelf-dropzone-hint')}>
                        Drop documents here to add them to {currentName} · {UPLOAD_LIMITS}
                      </p>
                    )}
                  </>
                )}
              </Zone>
            </>
          )}
        </section>
      </div>
    </>
  );
}
