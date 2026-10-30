import type { UseFoldersFn } from '../contracts';

const EMPTY = new Map<never, never>();

/** STUB (0.4 U1): no folders. U2 replaces it. */
export const useFolders: UseFoldersFn = () => ({
  folders: [],
  byId: EMPTY,
  rootId: null,
  childrenOf: () => [],
  pathTo: () => [],
  totals: null,
  totalItems: null,
  loading: false,
  error: undefined,
  offline: false,
  stale: false,
  refresh: async () => undefined,
});
