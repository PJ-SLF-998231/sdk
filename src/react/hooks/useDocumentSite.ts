import type { UseDocumentSiteFn } from '../contracts';

/** STUB (0.4 U1): no site. U2 replaces it. */
export const useDocumentSite: UseDocumentSiteFn = () => ({ view: { kind: 'hidden' }, refresh: async () => undefined });
