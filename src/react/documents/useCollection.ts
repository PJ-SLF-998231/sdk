import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ThumbLoader } from '../../internal/contracts';
import type { DocumentCollectionProps, ShelfSource } from '../contracts';
import { createDirectThumbLoader, noThumbs } from '../directThumbs';
import { useShelfSessionState } from '../useShelfSession';

/**
 * What a collection draws its thumbnails with: the session's cached loader once the session has opened, else an uncached
 * direct one over the client (no IndexedDB, or before it opened), else none.
 */
export function useCollectionLoader(source: ShelfSource): { loader: ThumbLoader; connected: boolean } {
  const s = useShelfSessionState(source, false);
  const cached = s.session?.parts?.loader ?? null;
  const client = cached ? null : s.client;
  const direct = useMemo(() => (client ? createDirectThumbLoader(client) : null), [client]);
  useEffect(() => () => direct?.dispose(), [direct]);
  return { loader: cached ?? direct ?? noThumbs, connected: !!s.client };
}

/** The handlers a collection hands down unchanged, plus a near-end callback that also asks the listing for its next page. */
export function useNearEnd(onNearEnd: DocumentCollectionProps['onNearEnd'], prefetchNext?: () => void): () => void {
  const latest = useRef({ onNearEnd, prefetchNext });
  latest.current = { onNearEnd, prefetchNext };
  return useCallback(() => {
    latest.current.prefetchNext?.();
    latest.current.onNearEnd?.();
  }, []);
}
