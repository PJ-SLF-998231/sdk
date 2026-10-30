import type { UseDocumentFn } from '../contracts';

/** STUB (0.4 U1): no document. U2 replaces it. */
export const useDocument: UseDocumentFn = () => ({ loading: false, error: undefined, offline: false, stale: false, refresh: async () => undefined });
