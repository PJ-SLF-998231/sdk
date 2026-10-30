import type { UseFolderFn } from '../contracts';

/** STUB (0.4 U1): an empty folder. U2 replaces it. */
export const useFolder: UseFolderFn = () => ({
  folder: null,
  subfolders: [],
  path: [],
  items: [],
  complete: true,
  nextCursor: null,
  loadMore: async () => undefined,
  prefetchNext: () => undefined,
  loading: false,
  error: undefined,
  offline: false,
  refresh: async () => undefined,
});
