import { useCallback, useMemo } from 'react';
import { LISTING_PAGE_SIZE, useFolderListing } from '../../hooks/useFolderListing';
import type { OverlayItem } from '../../internal/contracts';
import type { UseFolderFn } from '../contracts';
import { useShelfSessionState } from '../useShelfSession';
import { useFoldersOf } from './useFolders';

/**
 * One folder: its record, subfolders and path (from useFolders) and its documents, page by page, with queued
 * changes applied. `null` is the key's root folder.
 */
export const useFolder: UseFolderFn = (folderId, opts) => {
  const s = useShelfSessionState(opts, true);
  const { folders, outbox, entries, session } = useFoldersOf(s);
  const listing = useFolderListing(s.swr, s.client, { folderId, recursive: false, pageSize: opts?.pageSize ?? LISTING_PAGE_SIZE });

  const items = useMemo<OverlayItem[]>(() => {
    if (!outbox || !session?.applyOutbox) return listing.items as OverlayItem[]; // until the lazy outbox chunk has arrived the items render as they are
    return session.applyOutbox(listing.items, entries, folderId);
  }, [listing.items, outbox, session, entries, folderId]);

  const { prefetchNext: fetchNext, refresh: refreshListing } = listing;
  const prefetchNext = useCallback(() => void fetchNext(), [fetchNext]);
  const { refresh: refreshFolders } = folders;
  const refresh = useCallback(async () => void (await Promise.all([refreshListing(), refreshFolders()])), [refreshListing, refreshFolders]);
  const id = folderId ?? folders.rootId;
  return {
    folder: (id ? folders.byId.get(id) : undefined) ?? null,
    subfolders: folders.childrenOf(folderId),
    path: folders.pathTo(folderId),
    items,
    complete: listing.complete,
    nextCursor: listing.nextCursor,
    loadMore: listing.loadMore,
    prefetchNext,
    loading: listing.loading,
    error: listing.error ?? folders.error,
    offline: listing.offline || folders.offline,
    refresh,
  };
};
