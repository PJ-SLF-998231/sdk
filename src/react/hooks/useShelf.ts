import { useMemo } from 'react';
import type { UseShelfFn } from '../contracts';
import { toShelfResult, useShelfSessionState } from '../useShelfSession';

/**
 * Where a hook or component gets its Shelf from: props.client > props.baseUrl > nearest ShelfProvider > none.
 * Status is 'disconnected' with none, 'auth-lost' after a 401, 'ready' once /info has answered.
 */
export const useShelf: UseShelfFn = (source) => {
  const s = useShelfSessionState(source, true);
  return useMemo(() => toShelfResult(s), [s.client, s.access, s.rootFolderId, s.discarded, s.infoLoaded, s.lost]); // eslint-disable-line react-hooks/exhaustive-deps
};
