import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ComponentType, DragEvent, ReactNode } from 'react';
import { deepEqual } from '../cache/reconcile';
import { createShelfClient, isAuthLost, isOfflineError, ShelfError } from '../client';
import type { ShelfClient } from '../client';
import { useFolderListing } from '../hooks/useFolderListing';
import { useOnline } from '../hooks/useOnline';
import { useOutbox } from '../hooks/useOutbox';
import { useResource } from '../hooks/useResource';
import type { ShelfFolder as FolderRecord, ShelfInfo, ShelfItem } from '../types';
import { gridColumns, useElementWidth, useVirtualRows } from '../virtual';
import type { Pending } from './ActionDialog';
import type { MenuAction } from './ActionMenu';
import { cx } from './cx';
import { DocumentCard } from './DocumentCard';
import { DocumentRow } from './DocumentRow';
import type { Detail } from './DocumentPage';
import {
  describeContents,
  plural,
  UPLOAD_ACCEPT,
  UPLOAD_LIMITS,
} from './format';
import { FolderIcon, GridIcon, ListIcon } from './icons';
import { OfflineBanner } from './OfflineBanner';
import { getSession } from './session';
import type { Session } from './session';
import type { ItemAction } from './syncUi';
import type { OutboxOp, OverlayItem, ThumbLoader } from '../internal/contracts';
import type { SwrImpl } from '../cache/swr';

export interface ShelfFolderProps {
  /** A ready client. Takes precedence over `baseUrl`. */
  client?: ShelfClient;
  /** Integration API base URL (for example a same-origin proxy such as /api/shelf). */
  baseUrl?: string;
  /** Folder to open first, and the top of the breadcrumb. Defaults to the key's folder. */
  initialFolderId?: string;
  /** `light` (default), `dark`, or `auto` to follow the OS colour scheme. Only an explicit `auto` follows the OS, so a light-only host never shows a dark embed. */
  theme?: 'light' | 'dark' | 'auto';
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
}

type Layout = 'grid' | 'list';

/** Remembered per browser, like Shelf web's `shelf.layout`: a convenience, not something to sync. */
export const LAYOUT_KEY = 'shelf-sdk.layout';
export const TREE_KEY = 'shelf-sdk.folderTree';

const PAGE = 200;
/** The whole-integration census (document counts) is only the fallback for an API that sends no counts with /folders. */
const CENSUS_PAGE = 200;
const CENSUS_MAX_PAGES = 5;

/** Gallery geometry: matches the 0.2.0 grid (`minmax(230px, 1fr)`, 16px gap). */
const MIN_CARD = 230;
const GAP = 16;
/** Row estimate before the first card is measured: 4:3 thumbnail + 1px rule + padded body. */
const CARD_BODY_ESTIMATE = 84;
/** List view: a 40px thumbnail plus the 8px cell padding either side and the 1px rule. */
const TABLE_ROW_HEIGHT = 57;
const TABLE_HEAD_HEIGHT = 40;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and locked-down hosts can refuse storage; it still works, it just isn't remembered.
  }
}

function describe(err: unknown, action: string): string {
  if (err instanceof ShelfError) {
    if (err.status === 413) return `${action}: the file is too large.`;
    if (err.status === 415) return `${action}: this file type is not supported.`;
    return `${action}: ${err.message}`;
  }
  return `${action}: ${err instanceof Error ? err.message : 'something went wrong'}`;
}

interface Census {
  /** Documents directly in each folder. */
  direct: Map<string, number>;
  total: number;
}

/**
 * Documents at any depth under each folder, from the counts /folders sends (`total_item_count`, else
 * `item_count` summed up the tree). Null when any folder lacks them: the caller then falls back to the census.
 */
function totalsFromFolders(folders: readonly FolderRecord[]): Map<string, number> | null {
  if (folders.length === 0) return null;
  const kids = new Map<string, FolderRecord[]>();
  for (const f of folders) if (f.parent_id) kids.set(f.parent_id, [...(kids.get(f.parent_id) ?? []), f]);
  const out = new Map<string, number>();
  const visiting = new Set<string>();
  const total = (f: FolderRecord): number | null => {
    const hit = out.get(f.id);
    if (hit !== undefined) return hit;
    let n: number;
    if (typeof f.total_item_count === 'number') n = f.total_item_count;
    else {
      if (typeof f.item_count !== 'number' || visiting.has(f.id)) return null;
      visiting.add(f.id);
      n = f.item_count;
      for (const c of kids.get(f.id) ?? []) {
        const t = total(c);
        if (t === null) {
          visiting.delete(f.id);
          return null;
        }
        n += t;
      }
      visiting.delete(f.id);
    }
    out.set(f.id, n);
    return n;
  };
  for (const f of folders) if (total(f) === null) return null;
  return out;
}

/* ------------------------------------------------------------------ lazily loaded parts */

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

/**
 * React.lazy that, once the chunk has arrived, mounts the component directly (no suspending) for components
 * created afterwards. `preload()` fetches the chunk ahead of use. One instance never swaps implementation.
 */
function lazyPart<P extends object>(load: Loader<P>) {
  let loaded: ComponentType<P> | null = null;
  const Lazy = lazy(load);
  const preload = (): void => {
    void load().then((m) => {
      loaded = m.default;
    }).catch(() => undefined);
  };
  function Part(props: P & { fallback: ReactNode }) {
    const { fallback, ...rest } = props;
    const [ready] = useState(() => loaded);
    if (ready) {
      const C = ready as unknown as ComponentType<object>;
      return <C {...rest} />;
    }
    const L = Lazy as unknown as ComponentType<object>;
    return (
      <Suspense fallback={fallback}>
        <L {...rest} />
      </Suspense>
    );
  }
  return { Part, preload };
}

type DocumentPageProps = Parameters<typeof import('./DocumentPage').DocumentPage>[0];
type FolderTreeProps = Parameters<typeof import('./FolderTree').FolderTree>[0];
type ActionDialogProps = Parameters<typeof import('./ActionDialog').ActionDialog>[0];

const DocumentPagePart = lazyPart<DocumentPageProps>(() => import('./DocumentPage').then((m) => ({ default: m.DocumentPage })));
const FolderTreePart = lazyPart<FolderTreeProps>(() => import('./FolderTree').then((m) => ({ default: m.FolderTree })));
const ActionDialogPart = lazyPart<ActionDialogProps>(() => import('./ActionDialog').then((m) => ({ default: m.ActionDialog })));

/** Fallbacks hold the space the part will take, so the page does not jump when the chunk lands. */
const docFallback = (
  <section className={cx('doc-body')} aria-label="Document details" aria-busy="true" style={{ minHeight: 420 }}>
    <p className={cx('status-note')} role="status">
      Loading...
    </p>
  </section>
);
const treeFallback = <div aria-busy="true" style={{ minHeight: 120 }} />;
const dialogFallback = <div className={cx('callout')} aria-busy="true" style={{ minHeight: 72 }} />;

/* ------------------------------------------------------------------ virtual gallery and list */

type Row = ShelfItem & Partial<Pick<OverlayItem, 'sync' | 'outboxId' | 'localOnly' | 'syncError'>>;

interface ListProps {
  items: readonly Row[];
  loader: ThumbLoader;
  selectedId: string | null;
  canWrite: boolean;
  onOpen: (id: string) => void;
  onRetry?: (outboxId: string) => void;
  onDiscard?: (outboxId: string) => void;
  onAction: (action: ItemAction, id: string) => void;
  onNearEnd: () => void;
}

function VirtualGallery({ items, loader, selectedId, canWrite, onOpen, onRetry, onDiscard, onAction, onNearEnd }: ListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(listRef);
  const cols = gridColumns(width, MIN_CARD, GAP);
  const cardW = width > 0 ? Math.max(0, (width - GAP * (cols - 1)) / cols) : MIN_CARD;
  const cardKey = Math.round(cardW);
  // Cards are as tall as the tallest one drawn so far at this width (what 0.2.0's grid row did for uniform content).
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const height = measured && measured.w === cardKey ? measured.h : Math.round((cardW * 3) / 4) + 1 + CARD_BODY_ESTIMATE;
  const rowCount = Math.ceil(items.length / cols);
  const { rows, totalSize } = useVirtualRows({ count: rowCount, rowHeight: height + GAP, scrollRef: listRef, onNearEnd });

  // One observer for every row drawn; created on first use because ref callbacks run before effects.
  const keyRef = useRef(cardKey);
  keyRef.current = cardKey;
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    if (!observer.current) {
      observer.current = new ResizeObserver((entries) => {
        let max = 0;
        for (const e of entries) max = Math.max(max, Math.ceil((e.target as HTMLElement).offsetHeight));
        if (max <= 0) return;
        const w = keyRef.current;
        setMeasured((cur) => (cur && cur.w === w ? (cur.h >= max ? cur : { w, h: max }) : { w, h: max }));
      });
    }
    observer.current.observe(el);
  }, []);
  // A new width means new card sizes: observe the rows again so the first report counts for it.
  useEffect(() => {
    const ro = observer.current;
    const list = listRef.current;
    if (!ro || !list) return;
    ro.disconnect();
    for (const el of Array.from(list.children)) ro.observe(el);
  }, [cardKey]);
  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );

  return (
    <div ref={listRef} className={cx('file-grid')} aria-label="Folder contents" style={{ display: 'block', position: 'relative', height: Math.max(0, totalSize - GAP) }}>
      {rows.map((r) => (
        <div
          key={r.key}
          ref={measure}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${r.start}px)`,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: GAP,
          }}
        >
          {items.slice(r.index * cols, r.index * cols + cols).map((f) => (
            <DocumentCard key={f.id} item={f} loader={loader} selected={f.id === selectedId} canWrite={canWrite} onOpen={onOpen} onRetry={onRetry} onDiscard={onDiscard} onAction={onAction} />
          ))}
        </div>
      ))}
    </div>
  );
}

function VirtualTable({ items, folderRows, folderCount, loader, selectedId, canWrite, onOpen, onRetry, onDiscard, onAction, onNearEnd }: ListProps & { folderRows: ReactNode; folderCount: number }) {
  // The scroll sentinel sits just above the table (not inside its overflow wrapper, which would be mistaken
  // for the scroller) and is nudged down past the header and folder rows, so row offsets count from the first document.
  const anchor = useRef<HTMLDivElement>(null);
  const { rows, totalSize } = useVirtualRows({ count: items.length, rowHeight: TABLE_ROW_HEIGHT, scrollRef: anchor, onNearEnd, overscan: 6 });
  const top = rows.length ? rows[0]!.start : 0;
  const bottom = rows.length ? Math.max(0, totalSize - (rows[rows.length - 1]!.start + rows[rows.length - 1]!.size)) : totalSize;
  const spacer = (h: number, key: string) =>
    h > 0 ? (
      <tr key={key} aria-hidden="true" style={{ height: h }}>
        <td colSpan={5} style={{ padding: 0, border: 0 }} />
      </tr>
    ) : null;
  return (
    <>
      <div ref={anchor} aria-hidden="true" style={{ height: 0, position: 'relative', top: TABLE_HEAD_HEIGHT + folderCount * TABLE_ROW_HEIGHT }} />
      <div className={cx('item-list-scroll')}>
        <table className={cx('item-list', 'item-list-fixed')} aria-label="Folder contents">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th className={cx('item-list-num')}>Size</th>
              <th>Added</th>
              <th>
                <span className={cx('visually-hidden')}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {folderRows}
            {spacer(top, 'top')}
            {rows.map((r) => {
              const f = items[r.index];
              return f ? <DocumentRow key={f.id} item={f} loader={loader} selected={f.id === selectedId} canWrite={canWrite} onOpen={onOpen} onRetry={onRetry} onDiscard={onDiscard} onAction={onAction} /> : null;
            })}
            {spacer(bottom, 'bottom')}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ the component */

export function ShelfFolder({ client: given, baseUrl, initialFolderId, theme = 'light', className, cacheScope, onAuthLost, documentId, initialDocumentId, onNavigate }: ShelfFolderProps) {
  const client = useMemo<ShelfClient | null>(
    () => given ?? (baseUrl ? createShelfClient({ baseUrl }) : null),
    [given, baseUrl],
  );
  const [revive, bump] = useReducer((n: number) => n + 1, 0);
  const session = useMemo<Session | null>(() => (client ? getSession(client, cacheScope) : null), [client, cacheScope, revive]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [lostSession, setLostSession] = useState<Session | null>(null);
  const onLost = useRef(onAuthLost);
  onLost.current = onAuthLost;

  useEffect(() => {
    if (!session) return;
    if (session.disposed) {
      bump(); // idle-disposed before this mount: take a fresh one
      return;
    }
    session.retain();
    const offReady = session.onReady(rerender);
    const offDiscarded = session.onDiscarded(rerender);
    const offLost = session.onAuthLost((err) => {
      setLostSession(session);
      onLost.current?.(err);
    });
    rerender(); // the store may have opened between render and this effect
    return () => {
      offReady();
      offDiscarded();
      offLost();
      session.release();
    };
  }, [session]);

  const rootClass = ['shelf-sdk', className].filter(Boolean).join(' ');
  const themeAttr: string = theme;

  if (!client || !session || lostSession === session || session.authLost) {
    return (
      <div className={rootClass} data-theme={themeAttr}>
        <div className={cx('callout', 'notice')} role="alert">
          <strong>Shelf isn&apos;t connected</strong>
          <p>The document store is not set up for this site yet.</p>
          {session && session.discarded > 0 && (
            <p data-testid="shelf-discarded">
              {plural(session.discarded, 'pending change')} could not be sent and {session.discarded === 1 ? 'was' : 'were'} discarded.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <FolderView
      key={`${initialFolderId ?? ''}`}
      session={session}
      initialFolderId={initialFolderId}
      documentId={documentId}
      initialDocumentId={initialDocumentId}
      onNavigate={onNavigate}
      rootClass={rootClass}
      themeAttr={themeAttr}
    />
  );
}

interface ViewProps {
  session: Session;
  initialFolderId?: string;
  documentId?: string | null;
  initialDocumentId?: string;
  onNavigate?: ShelfFolderProps['onNavigate'];
  rootClass: string;
  themeAttr: string;
}

const mergeSame = <T,>(prev: T | undefined, next: T): T => (prev !== undefined && deepEqual(prev, next) ? prev : next);

function FolderView({ session, initialFolderId, documentId, initialDocumentId, onNavigate, rootClass, themeAttr }: ViewProps) {
  const client = session.client;
  const parts = session.parts;
  const swr: SwrImpl | null = parts?.swr ?? null;
  const loader = parts?.loader ?? null;

  const infoRes = useResource<ShelfInfo>(
    swr,
    useMemo(() => (swr ? { key: 'info', merge: mergeSame, fetcher: (signal: AbortSignal) => client.info({ signal }) } : null), [swr, client]),
  );
  const foldersRes = useResource<FolderRecord[]>(
    swr,
    useMemo(
      () =>
        swr
          ? { key: 'folders', merge: mergeSame, fetcher: async (signal: AbortSignal) => {
              const all = await client.folders({ signal });
              return Array.isArray(all) ? all : [];
            } }
          : null,
      [swr, client],
    ),
  );
  const folders = foldersRes.data ?? EMPTY_FOLDERS;
  const ready = infoRes.data !== undefined && foldersRes.data !== undefined;
  const writeKey = infoRes.data?.access === 'read_write';

  // The top of the breadcrumb is decided once, when the folders first arrive.
  const [rootId, setRootId] = useState<string | null | undefined>(undefined);
  if (rootId === undefined && ready) {
    const ids = new Set(folders.map((f) => f.id));
    const tops = folders.filter((f) => !f.parent_id || !ids.has(f.parent_id));
    setRootId(initialFolderId ?? (tops.length === 1 ? tops[0]!.id : null));
  }
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const currentId: string | null = chosen !== undefined ? chosen : (rootId ?? null);
  const open2 = ready && rootId !== undefined;

  const [edits, setEdits] = useState<{ patched: Record<string, Partial<ShelfItem>>; removed: string[] }>(NO_EDITS);
  /** Server items for uploads that just landed, shown until the listing has caught up. */
  const [landed, setLanded] = useState<ShelfItem[]>(NO_LANDED);
  // The open document: the host's when it passes `documentId`, else kept here (opened first from `initialDocumentId`).
  const [innerDocId, setInnerDocId] = useState<string | null>(initialDocumentId ?? null);
  const controlled = documentId !== undefined;
  const selectedId = controlled ? documentId : innerDocId;
  const controlledRef = useRef(controlled);
  controlledRef.current = controlled;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const setSelectedId = useCallback((id: string | null) => {
    if (!controlledRef.current) setInnerDocId(id);
  }, []);
  const notify = useCallback((folderId: string | null, docId: string | null) => navigateRef.current?.({ folderId, documentId: docId }), []);
  const [pending, setPending] = useState<Pending | null>(null);
  const go = useCallback((id: string | null) => {
    setChosen(id);
    setSelectedId(null);
    notify(id, null);
    setPending(null);
    setEdits(NO_EDITS);
    setLanded(NO_LANDED);
  }, [setSelectedId, notify]);

  const online = useOnline();
  // The offline outbox exists for read_write keys only. It lives in IndexedDB when the host gave a cacheScope.
  const outbox = writeKey && parts ? session.ensureOutbox() : null;
  // Write controls appear once the (lazily loaded) outbox is there to take the change.
  const canWrite = writeKey && !!outbox;
  const outboxView = useOutbox(outbox);
  useEffect(() => {
    outbox?.start();
  }, [outbox]);

  const listing = useFolderListing(open2 ? swr : null, open2 ? client : null, { folderId: currentId, recursive: false, pageSize: PAGE });
  const items = useMemo<Row[]>(() => {
    let base: ShelfItem[] = listing.items;
    if (edits !== NO_EDITS) {
      base = base.filter((x) => !edits.removed.includes(x.id)).map((x) => (edits.patched[x.id] ? { ...x, ...edits.patched[x.id] } : x));
    }
    if (landed.length > 0) {
      const have = new Set(base.map((x) => x.id));
      const extra = landed.filter((x) => !have.has(x.id) && (x.folder_id ?? null) === currentId && !edits.removed.includes(x.id));
      if (extra.length > 0) base = [...extra, ...base];
    }
    // Until the lazy outbox chunk has arrived the items render as they are.
    if (!outbox || !session.applyOutbox) return base;
    return session.applyOutbox(base, outboxView.entries, currentId) as Row[];
  }, [listing.items, edits, landed, outbox, session, outboxView.entries, currentId]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const detailRes = useResource<Detail>(
    swr,
    useMemo(
      () => (swr && selectedId ? { key: `file:${selectedId}`, merge: mergeSame, fetcher: (signal: AbortSignal) => client.getFile(selectedId, { signal }) as Promise<Detail> } : null),
      [swr, client, selectedId],
    ),
  );
  const selected = useMemo<Detail | null>(() => {
    if (!selectedId) return null;
    const row = items.find((x) => x.id === selectedId);
    const base = detailRes.data ?? row;
    if (!base) return null;
    // A queued rename shows at once; the detail keeps its text and preview.
    const queued = row && row.sync ? { filename: row.filename, folder_id: row.folder_id, sync: row.sync } : {};
    return { ...base, ...(edits.patched[selectedId] ?? {}), ...queued };
  }, [selectedId, items, detailRes.data, edits]);

  // A document opened by a deep link may live in another folder than the one showing: follow it, so the breadcrumb is right.
  const detailFolder = selectedId && detailRes.data?.id === selectedId ? (detailRes.data.folder_id ?? null) : undefined;
  useEffect(() => {
    if (open2 && detailFolder !== undefined && detailFolder !== currentRef.current) setChosen(detailFolder);
  }, [open2, detailFolder]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [over, setOver] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(() => (readStore(LAYOUT_KEY) === 'list' ? 'list' : 'grid'));
  const [treeOpen, setTreeOpen] = useState<boolean>(() => readStore(TREE_KEY) === 'open');
  const picker = useRef<HTMLInputElement>(null);

  const setLayout = (next: Layout) => {
    setLayoutState(next);
    writeStore(LAYOUT_KEY, next);
  };
  const toggleTree = () => {
    const next = !treeOpen;
    setTreeOpen(next);
    writeStore(TREE_KEY, next ? 'open' : 'closed');
  };

  const fail = useCallback(
    (err: unknown, action: string) => {
      if (err instanceof ShelfError && err.code === 'not_configured') session.loseAuth(err);
      else if (!isAuthLost(err)) setActionError(describe(err, action));
    },
    [session],
  );

  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const currentRef = useRef(currentId);
  currentRef.current = currentId;

  // Document counts. /folders sends them when the API is new enough; else count by listing everything (capped).
  const countsFromFolders = useMemo(() => totalsFromFolders(folders), [folders]);
  const needCensus = ready && countsFromFolders === null;
  const [census, setCensus] = useState<Census | null>(null);
  const [censusTick, bumpCensus] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!needCensus) {
      setCensus(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const direct = new Map<string, number>();
        let total = 0;
        let after: string | undefined;
        for (let page = 0; page < CENSUS_MAX_PAGES; page++) {
          const res = await client.listFiles({ recursive: true, limit: CENSUS_PAGE, ...(after ? { cursor: after } : {}) });
          if (!live) return;
          for (const f of Array.isArray(res?.items) ? res.items : []) {
            total += 1;
            if (f.folder_id) direct.set(f.folder_id, (direct.get(f.folder_id) ?? 0) + 1);
          }
          if (!res?.next_cursor) {
            setCensus({ direct, total });
            return;
          }
          after = res.next_cursor;
        }
        setCensus(null); // too many to count here: no counts rather than wrong ones
      } catch {
        if (live) setCensus(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, needCensus, censusTick]);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const childrenOf = useCallback(
    (parent: string | null) =>
      (parent
        ? folders.filter((f) => f.parent_id === parent)
        : folders.filter((f) => !f.parent_id || !byId.has(f.parent_id))
      )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, byId],
  );
  const subfolders = useMemo(() => childrenOf(currentId), [childrenOf, currentId]);
  const crumbs = useMemo(() => {
    const out: FolderRecord[] = [];
    let id = currentId;
    while (id) {
      const f = byId.get(id);
      if (!f) break;
      out.unshift(f);
      if (id === rootId) break;
      id = f.parent_id ?? null;
    }
    return out;
  }, [currentId, rootId, byId]);

  // Documents at any depth under each folder (null while unknown).
  const totals = useMemo<Map<string, number> | null>(() => {
    if (countsFromFolders) return countsFromFolders;
    if (!census) return null;
    const out = new Map<string, number>();
    const sum = (id: string): number => {
      const hit = out.get(id);
      if (hit !== undefined) return hit;
      let n = census.direct.get(id) ?? 0;
      for (const c of folders) if (c.parent_id === id) n += sum(c.id);
      out.set(id, n);
      return n;
    };
    for (const f of folders) sum(f.id);
    return out;
  }, [countsFromFolders, census, folders]);
  const totalItems = useMemo<number | null>(() => {
    if (countsFromFolders) {
      const ids = new Set(folders.map((f) => f.id));
      let n = 0;
      for (const f of folders) if (!f.parent_id || !ids.has(f.parent_id)) n += countsFromFolders.get(f.id) ?? 0;
      return n;
    }
    return census ? census.total : null;
  }, [countsFromFolders, census, folders]);

  const currentName = (currentId ? byId.get(currentId)?.name : undefined) ?? (rootId ? byId.get(rootId)?.name : undefined) ?? 'this folder';
  const rootName = (rootId ? byId.get(rootId)?.name : undefined) ?? 'Files';
  const hasFolders = rootId == null ? folders.length > 0 : folders.some((f) => f.id !== rootId);

  const locationOf = (item: ShelfItem): string => {
    const names: string[] = [];
    let id: string | null = item.folder_id ?? null;
    while (id) {
      const f = byId.get(id);
      if (!f) break;
      names.unshift(f.name);
      if (id === rootId) break;
      id = f.parent_id ?? null;
    }
    return names.join(' / ') || rootName;
  };

  // Fetch the lazily loaded parts while the browser is idle, so opening one does not wait for a chunk.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      DocumentPagePart.preload();
      ActionDialogPart.preload();
      if (hasFolders) FolderTreePart.preload();
    }, 0);
    return () => clearTimeout(t);
  }, [ready, hasFolders]);

  const refreshAll = async () => {
    bumpCensus();
    await Promise.all([listing.refresh(), foldersRes.refresh()]);
  };

  // A queued change reached the server: show the server's answer until the refreshed listing arrives.
  useEffect(() => {
    if (!outbox) return;
    return outbox.on('applied', ({ entry, item }) => {
      const op = entry.op;
      if (op.kind === 'upload') {
        if (item) setLanded((l) => [item, ...l.filter((x) => x.id !== item.id)]);
      } else if (op.kind === 'rename') {
        if (item) setEdits((e) => ({ ...e, patched: { ...e.patched, [op.fileId]: { ...(e.patched[op.fileId] ?? {}), ...item } } }));
      } else if (op.kind === 'delete' || (op.kind === 'move' && op.folderId !== currentRef.current)) {
        setEdits((e) => ({ ...e, removed: [...e.removed, op.fileId] }));
      }
      bumpCensus();
      void foldersRes.refresh();
      void refreshRef.current();
    });
  }, [outbox, foldersRes.refresh]);
  refreshRef.current = listing.refresh;

  const enqueue = async (op: OutboxOp, action: string) => {
    if (!outbox) return;
    setWorking(true);
    try {
      await outbox.enqueue(op);
      setPending(null);
      setActionError(null);
    } catch (err) {
      fail(err, action);
    } finally {
      setWorking(false);
    }
  };

  const upload = async (list: FileList | File[]) => {
    if (!outbox) return;
    for (const file of Array.from(list)) {
      try {
        await outbox.enqueue({
          kind: 'upload',
          folderId: currentId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          bytes: await file.arrayBuffer(),
          clientRef: '', // the outbox mints the UUID that makes a retried upload idempotent
        });
      } catch (err) {
        fail(err, `Could not upload ${file.name}`);
      }
    }
  };

  const renameItem = (item: ShelfItem, filename: string) =>
    void enqueue({ kind: 'rename', fileId: item.id, filename, baseFilename: item.filename }, 'Could not rename');

  const moveItem = (item: ShelfItem, folderId: string) => {
    if (selectedId) {
      setSelectedId(null);
      notify(currentRef.current, null);
    }
    void enqueue({ kind: 'move', fileId: item.id, folderId, baseFolderId: item.folder_id ?? null }, 'Could not move');
  };

  const deleteItem = (item: ShelfItem) => {
    if (selectedId) {
      setSelectedId(null);
      notify(currentRef.current, null);
    }
    void enqueue({ kind: 'delete', fileId: item.id }, 'Could not delete');
  };

  const onRetry = useCallback(
    (id: string) => {
      const entry = outbox?.list().find((e) => e.id === id);
      void outbox?.retry(id, entry?.status === 'conflict' ? { force: true } : undefined);
    },
    [outbox],
  );
  const onDiscard = useCallback((id: string) => void outbox?.discard(id), [outbox]);

  // Only what the integration API can do: it renames, moves and deletes documents (read_write keys).
  // It cannot create, rename, move or delete folders, so no menu offers those.
  const itemActions = (item: ShelfItem): MenuAction[] =>
    canWrite
      ? [
          { label: 'Rename', onSelect: () => setPending({ kind: 'rename', item }) },
          { label: 'Move to…', onSelect: () => setPending({ kind: 'move', item }) },
          { label: 'Delete', onSelect: () => setPending({ kind: 'delete', item }), danger: true },
        ]
      : [];

  // Stable, so the memoised cards and rows skip re-rendering when something unrelated changes.
  const onOpen = useCallback((id: string) => {
    if (id.startsWith('local:')) return; // an upload that has not landed has no document to open yet
    setSelectedId(id);
    notify(currentRef.current, id);
  }, [setSelectedId, notify]);
  const onAction = useCallback((action: ItemAction, id: string) => {
    const item = itemsRef.current.find((x) => x.id === id);
    if (item) setPending({ kind: action, item });
  }, []);
  const { prefetchNext } = listing;
  const onNearEnd = useCallback(() => void prefetchNext(), [prefetchNext]);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const dropProps = canWrite
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer?.files?.length) void upload(e.dataTransfer.files);
        },
      }
    : {};

  // What went wrong loading, other than being offline or signed out (those have their own handling).
  const loadError = (() => {
    const pick = (err: unknown, action: string) => (err !== undefined && !isAuthLost(err) && !isOfflineError(err) ? describe(err, action) : null);
    return (
      pick(infoRes.error, 'Could not load Shelf') ??
      pick(foldersRes.error, 'Could not load Shelf') ??
      pick(listing.error, 'Could not load files') ??
      pick(detailRes.error, 'Could not load the document')
    );
  })();
  const error = actionError ?? loadError;
  const addingCount = outboxView.entries.filter((e) => e.op.kind === 'upload' && (e.status === 'pending' || e.status === 'running')).length;
  const offline = infoRes.offline || foldersRes.offline || listing.offline || detailRes.offline;

  // Nothing is known about this folder's documents until the first page (or the cache) answers.
  const listingKnown = listing.complete || listing.nextCursor !== null || listing.items.length > 0 || listing.error !== undefined;
  const listLoading = open2 && !listingKnown && items.length === 0 && subfolders.length === 0;
  const isEmpty = open2 && listingKnown && subfolders.length === 0 && items.length === 0 && !error;
  const headerMeta =
    totalItems !== null ? `${plural(totalItems, 'item')} · ${plural(folders.length, 'folder')}` : folders.length ? plural(folders.length, 'folder') : '';

  const folderCaption = (f: FolderRecord): string | null => {
    const kids = folders.filter((c) => c.parent_id === f.id).length;
    if (totals) return describeContents({ folders: kids, items: totals.get(f.id) ?? 0 });
    return kids > 0 ? plural(kids, 'folder') : null; // document counts unknown: say nothing rather than guess
  };

  const dialog = pending && (
    <ActionDialogPart.Part
      key={`${pending.kind}:${pending.item.id}`}
      fallback={dialogFallback}
      pending={pending}
      folders={folders}
      busy={working}
      onRename={renameItem}
      onMove={moveItem}
      onDelete={deleteItem}
      onCancel={() => setPending(null)}
    />
  );

  const hint = canWrite ? (
    <p className={cx('dropzone-limits', 'shelf-dropzone-hint')}>
      Drop documents here to add them to {currentName} · {UPLOAD_LIMITS}
    </p>
  ) : null;

  const loadMore = listing.nextCursor && !listing.loadingMore && (
    <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'more')} onClick={() => void listing.loadMore()}>
      Load more
    </button>
  );

  const listProps: ListProps | null = loader
    ? { items, loader, selectedId, canWrite, onOpen, onRetry: outbox ? onRetry : undefined, onDiscard: outbox ? onDiscard : undefined, onAction, onNearEnd }
    : null;
  // Keyed so the list re-measures where it starts when the content above it (the folders) changes.
  const listKey = `${currentId ?? ''}:${subfolders.length}`;

  const gallery = (
    <>
      {subfolders.length > 0 && (
        <>
          <h2 className={cx('kicker', 'shelf-section-label')}>Folders</h2>
          <div className={cx('folder-grid')}>
            {subfolders.map((f) => {
              const caption = folderCaption(f);
              return (
                <article key={f.id} className={cx('card', 'folder-tile')} aria-label={`Folder ${f.name}`}>
                  <button type="button" className={cx('link-btn', 'folder-tile-main')} onClick={() => go(f.id)}>
                    <FolderIcon />
                    <span className={cx('folder-tile-text')}>
                      <span className={cx('folder-tile-name')}>{f.name}</span>
                      {caption && <span className={cx('card-meta')}>{caption}</span>}
                    </span>
                  </button>
                </article>
              );
            })}
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

  const folderRows = subfolders.map((f) => (
    <tr key={`d-${f.id}`} className={cx('item-row', 'item-row--folder')}>
      <td>
        <button type="button" className={cx('link-btn', 'item-name')} onClick={() => go(f.id)}>
          <span className={cx('item-thumb', 'item-thumb--folder')}>
            <FolderIcon />
          </span>
          <span className={cx('item-name-text')}>{f.name}</span>
        </button>
      </td>
      <td className={cx('item-list-muted')}>{folderCaption(f) ?? ''}</td>
      <td className={cx('item-list-num', 'item-list-muted')}>—</td>
      <td className={cx('item-list-muted')}></td>
      <td className={cx('item-list-actions')} />
    </tr>
  ));

  const table =
    listProps &&
    (items.length > 0 ? (
      <VirtualTable key={listKey} {...listProps} folderRows={folderRows} folderCount={subfolders.length} />
    ) : (
      <div className={cx('item-list-scroll')}>
        <table className={cx('item-list', 'item-list-fixed')} aria-label="Folder contents">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th className={cx('item-list-num')}>Size</th>
              <th>Added</th>
              <th>
                <span className={cx('visually-hidden')}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>{folderRows}</tbody>
        </table>
      </div>
    ));

  return (
    <div className={rootClass} data-theme={themeAttr}>
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
        {/* The folder tree waits collapsed, as an icon button at the start of the breadcrumb row, until it's asked for. */}
        {hasFolders && (
          <aside className={cx('shelf-sidebar', treeOpen && 'is-open')} aria-label="Folders">
            <button
              type="button"
              className={cx('btn', 'btn--ghost', 'btn--sm', 'shelf-sidebar-toggle')}
              aria-expanded={treeOpen}
              aria-controls="shelf-sdk-folder-tree"
              title={treeOpen ? 'Hide folders' : 'Show folders'}
              onClick={toggleTree}
            >
              <FolderIcon open={treeOpen} />
              <span className={cx('shelf-sidebar-toggle-label')}>{treeOpen ? 'Hide folders' : 'Show folders'}</span>
            </button>
            <div id="shelf-sdk-folder-tree" className={cx('shelf-sidebar-tree')} hidden={!treeOpen}>
              {treeOpen && (
                <FolderTreePart.Part
                  fallback={treeFallback}
                  rootId={rootId ?? null}
                  rootName={rootName}
                  folders={folders}
                  files={items}
                  totals={totals}
                  currentFolderId={currentId}
                  currentFileId={selectedId}
                  onOpenFolder={go}
                  onOpenFile={(f) => {
                    setSelectedId(f.id);
                    notify(f.folder_id ?? null, f.id);
                  }}
                />
              )}
            </div>
          </aside>
        )}

        <section className={cx('shelf-main')} aria-label={`Contents of ${currentName}`}>
          <div className={cx('shelf-crumbs-row')}>
            <nav className={cx('breadcrumbs')} aria-label="Folder path">
              <ol>
                {crumbs.length === 0 && (
                  <li>
                    <span className={cx('breadcrumb')} aria-current="page">
                      Files
                    </span>
                  </li>
                )}
                {crumbs.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={cx('link-btn', 'breadcrumb')}
                      aria-current={i === crumbs.length - 1 && !selected ? 'page' : undefined}
                      onClick={() => go(c.id)}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className={cx('shelf-crumbs-aside')}>{headerMeta && <span className={cx('file-count')}>{headerMeta}</span>}</div>
          </div>

          {dialog}

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
                onRename={canWrite ? () => setPending({ kind: 'rename', item: selected }) : undefined}
                onMove={canWrite ? () => setPending({ kind: 'move', item: selected }) : undefined}
                onDelete={canWrite ? () => setPending({ kind: 'delete', item: selected }) : undefined}
                onClose={() => {
                  setSelectedId(null);
                  setPending(null);
                  notify(currentId, null);
                }}
              />
            ) : (
              docFallback
            )
          ) : (
            <>
              <div className={cx('shelf-toolbar')}>
                {canWrite && (
                  <>
                    <button type="button" className={cx('btn', 'btn--accent', 'btn--sm')} onClick={() => picker.current?.click()}>
                      Add documents
                    </button>
                    <input
                      ref={picker}
                      type="file"
                      accept={UPLOAD_ACCEPT}
                      multiple
                      hidden
                      aria-label="Upload files"
                      onChange={(e) => {
                        if (e.target.files?.length) void upload(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </>
                )}
                <p className={cx('drag-status')} aria-live="polite">
                  {addingCount > 0 ? `Adding ${plural(addingCount, 'document')}…` : ''}
                </p>
                <div className={cx('layout-toggle')} role="group" aria-label="Layout">
                  <button type="button" className={cx('layout-toggle-btn')} aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
                    <GridIcon />
                    Gallery
                  </button>
                  <button type="button" className={cx('layout-toggle-btn')} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
                    <ListIcon />
                    List
                  </button>
                </div>
              </div>

              <div className={cx('shelf-dropzone')} data-drop={over ? 'valid' : undefined} data-testid="shelf-dropzone" {...dropProps}>
                {!open2 || !loader || listLoading ? (
                  <p className={cx('status-note')} role="status">
                    {!ready && (infoRes.offline || foldersRes.offline) ? "You're offline. Shelf will load when the connection is back." : 'Loading...'}
                  </p>
                ) : isEmpty ? (
                  <div className={cx('empty', 'empty--inline')}>
                    <p className={cx('empty-title')}>This folder is empty.</p>
                    {canWrite && <p>Drag documents here to add them.</p>}
                    {canWrite && <p className={cx('dropzone-limits')}>{UPLOAD_LIMITS}</p>}
                  </div>
                ) : (
                  <>
                    {layout === 'list' ? table : gallery}
                    {loadMore}
                    {hint}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const EMPTY_FOLDERS: FolderRecord[] = [];
const NO_EDITS = { patched: {}, removed: [] as string[] };
const NO_LANDED: ShelfItem[] = [];
