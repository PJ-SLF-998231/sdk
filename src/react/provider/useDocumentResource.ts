import { useMemo } from 'react';
import { useResource } from '../../hooks/useResource';
import type { ShelfDocument } from '../../types';
import type { ShelfSource } from '../contracts';
import { useShelfSessionState } from '../useShelfSession';
import type { ShelfSessionState } from '../useShelfSession';
import { mergeSame } from './merge';

/** The document under cache key `file:<id>`, the entry useDocument, useDocumentText and the document page share. */
export function useDocumentResource(id: string | null, source: ShelfSource | undefined) {
  const s: ShelfSessionState = useShelfSessionState(source, false);
  const { swr, client } = s;
  const res = useResource<ShelfDocument>(
    swr,
    useMemo(
      () => (swr && client && id ? { key: `file:${id}`, merge: mergeSame, fetcher: (signal: AbortSignal) => client.getFile(id, { signal }) as Promise<ShelfDocument> } : null),
      [swr, client, id],
    ),
  );
  const loading = !!id && !!client && !s.lost && res.data === undefined && res.error === undefined;
  return { s, res, loading };
}
