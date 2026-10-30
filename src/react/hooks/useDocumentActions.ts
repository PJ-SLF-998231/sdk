import type { UseDocumentActionsFn } from '../contracts';

/** STUB (0.4 U1): read-only. U2 replaces it. */
export const useDocumentActions: UseDocumentActionsFn = () => ({
  canWrite: false,
  rename: async () => undefined,
  move: async () => undefined,
  remove: async () => undefined,
});
