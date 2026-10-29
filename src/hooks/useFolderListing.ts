import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SwrHandleImpl, SwrImpl } from '../cache/swr';
import { deepEqual, reconcile } from '../cache/reconcile';
import type { ShelfClient } from '../client';
import type { FolderListingState } from '../internal/contracts';
import type { ShelfItem } from '../types';
import { useResource } from './useResource';

export const LISTING_PAGE_SIZE = 200;

export interface FolderListingOptions {
  /** null = the root. */
  folderId: string | null;
  recursive?: boolean;
  pageSize?: number;
}

export interface FolderListing {
  items: ShelfItem[];
  complete: boolean;
  nextCursor: string | null;
  /** First page not here yet (nothing cached). */
  loading: boolean;
  loadingMore: boolean;
  stale: boolean;
  fromCache: boolean;
  offline: boolean;
  error: unknown;
  /** Fetch the next page (deduped: one request however many callers). Resolves when appended. */
  prefetchNext: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Revalidate page 1 now. */
  refresh: () => Promise<void>;
}

export const listingKey = (folderId: string | null, recursive?: boolean): string => `listing:${folderId ?? 'root'}:${recursive ? 'r' : 'd'}`;

const EMPTY: ShelfItem[] = [];
/** One next-page request per handle, shared by every caller. */
const pageFlights = new WeakMap<object, Promise<void>>();

/** Page 1 (fresh) against what was loaded: keep every later page when page 1 is unchanged, else start over. */
export function mergeListing(prev: FolderListingState | undefined, next: FolderListingState): FolderListingState {
  if (!prev) return next;
  const n = next.items.length;
  // An empty or final page 1 shorter than what was loaded means items went away: start over.
  const shrank = prev.items.length > n && (n === 0 || next.complete);
  const prefixSame = !shrank && prev.items.length >= n && deepEqual(prev.items.slice(0, n), next.items);
  if (prefixSame) {
    if (prev.items.length > n) return prev; // later pages stay
    const same = prev.nextCursor === next.nextCursor && prev.complete === next.complete;
    return same ? prev : { ...prev, nextCursor: next.nextCursor, complete: next.complete, loadedAt: next.loadedAt };
  }
  const items = reconcile(prev.items, next.items);
  return { ...next, items };
}

export function fetchNextPage(
  handle: SwrHandleImpl<FolderListingState>,
  client: ShelfClient,
  opts: { pageSize: number; recursive?: boolean },
): Promise<void> {
  const existing = pageFlights.get(handle);
  if (existing) return existing;
  const cur = handle.snapshot().data;
  if (!cur || cur.complete || !cur.nextCursor) return Promise.resolve();
  const cursor = cur.nextCursor;
  const p = (async () => {
    try {
      const page = await client.listFiles({
        ...(cur.folderId ? { folder_id: cur.folderId } : {}),
        limit: opts.pageSize,
        cursor,
        ...(opts.recursive !== undefined ? { recursive: opts.recursive } : {}),
      });
      const now = handle.snapshot().data;
      // A revalidation reset the list while this page was on its way: drop the page.
      if (!now || now.nextCursor !== cursor) return;
      const nextCursor = page.next_cursor ?? null;
      handle.set({ ...now, items: [...now.items, ...reconcile(undefined, page.items)], nextCursor, complete: !nextCursor, loadedAt: Date.now() });
    } finally {
      pageFlights.delete(handle);
    }
  })();
  pageFlights.set(handle, p);
  return p;
}

/**
 * Pages of one folder: page 1 comes from the cache instantly and is revalidated; later pages append via
 * `prefetchNext`. When a revalidation finds page 1 unchanged the later pages are kept, else the list resets to page 1.
 */
export function useFolderListing(swr: SwrImpl | null, client: ShelfClient | null, options: FolderListingOptions): FolderListing {
  const { folderId, recursive } = options;
  const pageSize = options.pageSize ?? LISTING_PAGE_SIZE;
  const key = listingKey(folderId, recursive);

  const swrOptions = useMemo(
    () =>
      swr && client
        ? {
            key,
            merge: mergeListing,
            fetcher: async (signal: AbortSignal): Promise<FolderListingState> => {
              const page = await client.listFiles(
                { ...(folderId ? { folder_id: folderId } : {}), limit: pageSize, ...(recursive !== undefined ? { recursive } : {}) },
                { signal },
              );
              const nextCursor = page.next_cursor ?? null;
              return { folderId, items: page.items, nextCursor, complete: !nextCursor, loadedAt: Date.now() };
            },
          }
        : null,
    [swr, client, key, folderId, recursive, pageSize],
  );

  const res = useResource<FolderListingState>(swr, swrOptions);

  const [loadingMore, setLoadingMore] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const prefetchNext = useCallback(async (): Promise<void> => {
    if (!swr || !client || !swrOptions) return;
    const handle = swr.handle<FolderListingState>(swrOptions);
    const flight = fetchNextPage(handle, client, { pageSize, recursive });
    setLoadingMore(true);
    try {
      await flight;
    } catch {
      /* the next call retries; a failed page must not surface as an unhandled rejection */
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }, [swr, client, key, swrOptions, pageSize, recursive]);

  const data = res.data;
  return {
    items: data?.items ?? EMPTY,
    complete: data?.complete ?? false,
    nextCursor: data?.nextCursor ?? null,
    loading: res.loading && !data,
    loadingMore,
    stale: res.stale,
    fromCache: res.fromCache,
    offline: res.offline,
    error: res.error,
    prefetchNext,
    loadMore: prefetchNext,
    refresh: res.refresh,
  };
}
