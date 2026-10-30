import { useContext } from 'react';
import { ShelfContext } from '../ShelfProvider';
import type { UseShelfFn } from '../contracts';

/**
 * STUB (0.4 U1): resolves a client from props or the nearest provider but opens no session, so the status is never
 * 'ready'. U2 replaces it. Reading the context here makes provider and hooks share one context chunk in every format.
 */
export const useShelf: UseShelfFn = (source) => {
  const provided = useContext(ShelfContext);
  const client = source?.client ?? provided?.client ?? null;
  return { status: client ? 'connecting' : 'disconnected', client, access: null, rootFolderId: null, discarded: 0 };
};
