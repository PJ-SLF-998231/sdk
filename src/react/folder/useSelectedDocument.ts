import { useEffect, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import type { SwrImpl } from '../../cache/swr';
import type { ShelfClient } from '../../client';
import { useResource } from '../../hooks/useResource';
import type { OverlayItem } from '../../internal/contracts';
import type { ShelfItem } from '../../types';
import type { Detail } from '../DocumentPage';
import { mergeSame } from '../provider/merge';

/**
 * The open document: its full record (cache key `file:<id>`) over the listing's row, with a queued rename or an edit applied.
 * A document opened by a deep link may live in another folder than the one showing: `follow` moves the view to it, so the breadcrumb is right.
 */
export function useSelectedDocument(
  swr: SwrImpl | null,
  client: ShelfClient,
  selectedId: string | null,
  items: readonly (ShelfItem & Partial<OverlayItem>)[],
  patched: Record<string, Partial<ShelfItem>>,
  follow: { enabled: boolean; currentRef: MutableRefObject<string | null>; to(folderId: string | null): void },
) {
  const res = useResource<Detail>(
    swr,
    useMemo(() => (swr && selectedId ? { key: `file:${selectedId}`, merge: mergeSame, fetcher: (signal: AbortSignal) => client.getFile(selectedId, { signal }) as Promise<Detail> } : null), [swr, client, selectedId]),
  );
  const selected = useMemo<Detail | null>(() => {
    if (!selectedId) return null;
    const row = items.find((x) => x.id === selectedId);
    const base = res.data ?? row;
    if (!base) return null;
    // A queued rename shows at once; the detail keeps its text and preview.
    const queued = row && row.sync ? { filename: row.filename, folder_id: row.folder_id, sync: row.sync } : {};
    return { ...base, ...(patched[selectedId] ?? {}), ...queued };
  }, [selectedId, items, res.data, patched]);
  const folder = selectedId && res.data?.id === selectedId ? (res.data.folder_id ?? null) : undefined;
  const { enabled, currentRef, to } = follow;
  useEffect(() => {
    if (enabled && folder !== undefined && folder !== currentRef.current) to(folder);
  }, [enabled, folder, currentRef, to]);
  return { selected, res };
}
