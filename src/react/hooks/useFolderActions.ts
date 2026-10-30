import type { UseFolderActionsFn } from '../contracts';

/** STUB (0.4 U1): read-only. U8 replaces it. */
export const useFolderActions: UseFolderActionsFn = () => ({
  canWrite: false,
  create: async () => undefined,
  rename: async () => undefined,
  move: async () => undefined,
  remove: async () => undefined,
});
