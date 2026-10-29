/**
 * Shared contracts for the 0.3.0 local-first work. FROZEN after U1 lands: U2 (cache), U3 (outbox) and
 * U4 (virtual list) code against these; change them only through a manager-approved revision.
 *
 * Types and constants only. Each unit implements its contract in its own directory:
 *   U2 -> src/cache/**  (createCacheStore, createSwr, createThumbLoader, reconcile, useSwr hooks)
 *   U3 -> src/outbox/** (createOutbox, applyOutbox, useOutbox)
 *   U4 -> src/virtual/** and src/react/** (useVirtualRows, gridColumns, pickPreviewSize, Thumb, DocumentCard)
 * Where a function is listed below as a `type XFn`, the implementing module exports a function of that shape.
 */
import type { DragEvent, ReactNode, RefObject } from 'react';
import type { ShelfClient } from '../client';
import type { KvStore, PutResult } from '../storage/db';
import type { ListFilesParams, PreviewSize, ShelfDocument, ShelfFolder, ShelfItem, UploadOptions } from '../types';

export type { KvStore, PutResult } from '../storage/db';

const MiB = 1024 * 1024;

/* ===================================================================== U2: cache, SWR, thumbnails */

export interface CacheLimits {
  /** Total bytes of thumbnails kept in the `blobs` store; least recently used go first. */
  blobBudgetBytes: number;
  /** A single thumbnail larger than this is never stored. */
  maxBlobBytes: number;
  /** Total bytes across entries + blobs; over this, LRU blobs then oldest entries are evicted. */
  totalBudgetBytes: number;
  /** A single serialised listing/detail entry larger than this is never stored. */
  maxEntryBytes: number;
  /** Anything not read or written for this long is dropped on open. */
  maxAgeMs: number;
}

export const DEFAULT_LIMITS: Readonly<CacheLimits> = Object.freeze({
  blobBudgetBytes: 25 * MiB,
  maxBlobBytes: 2 * MiB,
  totalBudgetBytes: 50 * MiB,
  maxEntryBytes: 1.5 * MiB,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
});

/** A JSON-ish value stored in `entries`, with when it was stored. */
export interface CachedEntry<T = unknown> {
  value: T;
  storedAt: number;
  /** ETag of the response it came from, when the server sent one. */
  etag?: string | null;
}

/** A thumbnail stored in `blobs`. Bytes are an ArrayBuffer, never a Blob. */
export interface CachedBlob {
  bytes: ArrayBuffer;
  type: string;
  etag: string | null;
  size: number;
  storedAt: number;
  lastUsed: number;
}

export interface CacheStore {
  readonly kv: KvStore;
  readonly ns: string;
  /** False when memory-only (no cacheScope, no IndexedDB, or it failed mid-session). */
  readonly persistent: boolean;
  readonly limits: CacheLimits;
  getEntry<T>(key: string): Promise<CachedEntry<T> | undefined>;
  /** 'quota' means eviction could not make room; the caller carries on without caching. */
  setEntry<T>(key: string, value: T, etag?: string | null): Promise<PutResult>;
  deleteEntry(key: string): Promise<void>;
  getBlob(key: string): Promise<CachedBlob | undefined>;
  /** Evicts least-recently-used blobs to fit; refuses bytes over `limits.maxBlobBytes`. */
  putBlob(key: string, blob: Omit<CachedBlob, 'size' | 'storedAt' | 'lastUsed'>): Promise<PutResult>;
  /** Removes entries and blobs (never the outbox). Used by clearCache() and on auth loss. */
  purge(): Promise<void>;
  /** Another tab changed these entry keys (BroadcastChannel); returns the unsubscribe. */
  onExternalChange(listener: (keys: string[]) => void): () => void;
  close(): void;
}

export interface SwrState<T> {
  data: T | undefined;
  /** True while `data` came from the cache or is older than `staleMs` and a revalidation is pending/running. */
  stale: boolean;
  loading: boolean;
  /** Last revalidation error; cleared by the next success. `data` is kept. */
  error: unknown;
  /** Last revalidation failed with isOfflineError. */
  offline: boolean;
  fromCache: boolean;
  /** Epoch ms of the data's origin (cache write or network response). */
  updatedAt: number | null;
}

export interface SwrOptions<T> {
  key: string;
  /** Must honour the signal. */
  fetcher: (signal: AbortSignal, prev: T | undefined) => Promise<T>;
  /** Fresh window; within it focus/online do not refetch. Default 30_000. */
  staleMs?: number;
  /** Return prev when unchanged so React sees the same reference. Default: reconcile-free `Object.is`. */
  merge?: (prev: T | undefined, next: T) => T;
}

export interface SwrHandle<T> {
  snapshot(): SwrState<T>;
  subscribe(listener: () => void): () => void;
  /** Force a revalidation now (deduped with an in-flight one; supersedes it if `abortInFlight`). */
  refresh(opts?: { abortInFlight?: boolean }): Promise<void>;
  /** Drop interest; aborts the in-flight fetch when no subscriber is left. */
  release(): void;
}

export interface Swr {
  /** Same key => same handle (requests are deduped). */
  handle<T>(opts: SwrOptions<T>): SwrHandle<T>;
  /** Marks keys stale and revalidates handles that have subscribers. Wired to focus/online by the host. */
  revalidateAll(): void;
  invalidate(key: string): void;
  /** Drops memory + persisted data and aborts everything (auth lost / clearCache). */
  purge(): Promise<void>;
  destroy(): void;
}

export type CreateCacheStoreFn = (
  kv: KvStore,
  opts?: { limits?: Partial<CacheLimits>; now?: () => number },
) => CacheStore;
export type CreateSwrFn = (cache: CacheStore, opts?: { now?: () => number }) => Swr;

/** A folder listing as cached: every page loaded so far, in API order. */
export interface FolderListingState {
  folderId: string | null;
  items: ShelfItem[];
  nextCursor: string | null;
  /** True when no more pages exist. */
  complete: boolean;
  /** Folders (children + counts) known when this was stored. */
  folders?: ShelfFolder[];
  loadedAt: number;
}

/**
 * Merges a freshly fetched list into the previous one keeping the previous object for every item whose
 * fields are all equal (so memoised rows do not re-render). Result order follows `next`.
 */
export type ReconcileFn = <T extends { id: string }>(prev: readonly T[] | undefined, next: readonly T[]) => T[];

export interface ThumbRequest {
  id: string;
  size: PreviewSize;
  /** Changes when the document changes, so a replaced file does not show its old thumbnail. */
  version?: string | null;
  signal?: AbortSignal;
}

export interface ThumbLoader {
  /** Object URL for the thumbnail (cache first, then network with If-None-Match), or null if there is none. */
  load(req: ThumbRequest): Promise<string | null>;
  /** Synchronous: the object URL if already resolved in memory. */
  peek(id: string, size: PreviewSize): string | null;
  /** Revokes object URLs and aborts in-flight loads. */
  dispose(): void;
}

export type CreateThumbLoaderFn = (opts: { client: ShelfClient; cache: CacheStore; maxConcurrent?: number }) => ThumbLoader;

/* ===================================================================== U3: offline outbox */

export type OutboxOp =
  | {
      kind: 'upload';
      folderId: string | null;
      filename: string;
      contentType: string;
      size: number;
      bytes: ArrayBuffer;
      /** UUID, also sent as `client_ref` so a retry cannot create a second document. */
      clientRef: string;
      onDuplicate?: UploadOptions['on_duplicate'];
    }
  | {
      kind: 'rename';
      fileId: string;
      filename: string;
      /** The name the user saw; a different current name is a conflict. */
      baseFilename: string;
    }
  | {
      kind: 'move';
      fileId: string;
      folderId: string;
      /** The folder the user saw it in; a different current folder is a conflict. */
      baseFolderId: string | null;
    }
  | { kind: 'delete'; fileId: string };

/**
 * pending: waiting (or backing off). running: a request is in flight. failed: gave up or permanent error,
 * needs retry/discard. conflict: server state differs from what the user saw, needs a choice.
 */
export type OutboxStatus = 'pending' | 'running' | 'failed' | 'conflict';

export interface OutboxEntry {
  id: string;
  /** Monotonic per namespace; operations on one document run in `seq` order. */
  seq: number;
  op: OutboxOp;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; not before. */
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  error?: { status?: number; code?: string; message: string };
  /** The server's document after a conflict, for the UI to show. */
  serverState?: Partial<ShelfItem>;
}

export interface OutboxEvents {
  /** The entry list changed (add, status, remove). */
  change: OutboxEntry[];
  /** An entry was applied on the server and removed; `item` is the API's answer when there is one. */
  applied: { entry: OutboxEntry; item?: ShelfItem };
  /** Network reachability as the outbox sees it (failed with isOfflineError / recovered). */
  offline: boolean;
  /** 401/503 not_configured: the outbox stopped; `discarded` is how many changes were thrown away. */
  authLost: { discarded: number };
}

export interface Outbox {
  list(): OutboxEntry[];
  enqueue(op: OutboxOp): Promise<OutboxEntry>;
  /** Re-queue a failed/conflict entry. `force` overwrites the server value on a conflict. */
  retry(id: string, opts?: { force?: boolean }): Promise<void>;
  discard(id: string): Promise<void>;
  /** Start draining (also on 'online' and on cross-tab change). Idempotent. */
  start(): void;
  /** Resolves when nothing is pending or running (used by tests and flush-on-unload). */
  idle(): Promise<void>;
  /** Drops everything including stored upload bytes (auth lost). Resolves with how many entries went. */
  purge(): Promise<number>;
  on<K extends keyof OutboxEvents>(event: K, listener: (payload: OutboxEvents[K]) => void): () => void;
  destroy(): void;
}

export interface CreateOutboxOptions {
  kv: KvStore;
  client: ShelfClient;
  /** Parallel uploads. Default 3. Other ops run one per document. */
  uploadConcurrency?: number;
  /** Backoff: min(maxMs, baseMs * 2^attempts) * (0.5..1 jitter). Defaults 1000 / 60_000. */
  backoff?: { baseMs?: number; maxMs?: number };
  /** After this many network/5xx attempts an entry becomes `failed`. Default 8. */
  maxAttempts?: number;
  now?: () => number;
  random?: () => number;
  uuid?: () => string;
}
export type CreateOutboxFn = (opts: CreateOutboxOptions) => Outbox;

/** How an item should look given the outbox. */
export type ItemSyncState = 'synced' | 'pending' | 'failed' | 'conflict';

export interface OverlayItem extends ShelfItem {
  sync: ItemSyncState;
  /** The outbox entry behind `sync`, for retry/discard buttons. */
  outboxId?: string;
  /** An upload that has no server document yet (id is `local:<clientRef>`). */
  localOnly?: boolean;
  syncError?: string;
}

/**
 * Items as the user should see them: server items with queued renames/moves/deletes applied
 * (deleted ones removed), plus queued uploads for `folderId` as `localOnly` items.
 */
export type ApplyOutboxFn = (items: readonly ShelfItem[], entries: readonly OutboxEntry[], folderId: string | null) => OverlayItem[];

export interface OutboxView {
  entries: OutboxEntry[];
  pending: number;
  failed: number;
  conflicts: number;
  offline: boolean;
}
export type UseOutboxFn = (outbox: Outbox | null) => OutboxView;

/* ===================================================================== U4: virtual list, thumbs, cards */

export interface VirtualRowsOptions {
  /** Number of rows (a grid row holds `columns` items). */
  count: number;
  /** Row height in px (estimate before measuring; fixed-height lists never re-measure). */
  rowHeight: number;
  scrollRef: RefObject<HTMLElement | null>;
  overscan?: number;
  /** Called when the last rendered row is within `prefetchRows` of the end, to fetch the next cursor page. */
  onNearEnd?: () => void;
  prefetchRows?: number;
}

export interface VirtualRow {
  index: number;
  /** Stable React key. */
  key: string | number;
  /** px from the top of the scroll content. */
  start: number;
  size: number;
}

export interface VirtualRows {
  rows: VirtualRow[];
  /** Full scroll height in px, so the scrollbar and layout are right before rows render. */
  totalSize: number;
  scrollToIndex(index: number, opts?: { align?: 'start' | 'center' | 'end' }): void;
}
export type UseVirtualRowsFn = (opts: VirtualRowsOptions) => VirtualRows;

/** Columns that fit in `width` px for cards at least `minCard` wide with `gap` between; at least 1. */
export type GridColumnsFn = (width: number, minCard: number, gap: number) => number;

/**
 * Smallest size that is enough: 'small' when cssWidth * dpr <= 360 and available, else 'medium', else
 * 'large' only when asked (`allowLarge`, the document view). Returns null when nothing is available.
 */
export type PickPreviewSizeFn = (
  cssWidth: number,
  dpr: number,
  available: readonly string[],
  opts?: { allowLarge?: boolean },
) => PreviewSize | null;

export interface ThumbProps {
  loader: ThumbLoader;
  id: string;
  /** From the item's `preview_sizes`. */
  available: readonly string[];
  /** Part of the loader's cache key; pass `edited_at` so a changed file refetches. */
  version?: string | null;
  alt: string;
  /** Reserved box so nothing shifts when the image arrives. */
  width: number;
  height: number;
  /** Fallback (icon) shown while loading and when there is no thumbnail. */
  fallback?: ReactNode;
  className?: string;
  /** Load only once scrolled into view (IntersectionObserver). Default true. */
  lazy?: boolean;
}

export interface DocumentCardProps {
  /** Server item, optionally overlaid with outbox state. */
  item: ShelfItem & Partial<Pick<OverlayItem, 'sync' | 'outboxId' | 'localOnly' | 'syncError'>>;
  view: 'gallery' | 'list';
  loader: ThumbLoader;
  selected?: boolean;
  /** Handlers must be referentially stable (useCallback) so memoised cards skip re-rendering. */
  onOpen: (id: string) => void;
  onMenu?: (id: string, anchor: HTMLElement) => void;
  onRetry?: (outboxId: string) => void;
  onDiscard?: (outboxId: string) => void;
  onDragStart?: (id: string, e: DragEvent) => void;
}

/** The detail route's document, used by the lazily loaded DocumentPage. */
export type DocumentDetail = ShelfDocument;
/** Params for a listing request as the cache keys it. */
export type ListingKeyParams = Pick<ListFilesParams, 'folder_id' | 'recursive'>;
