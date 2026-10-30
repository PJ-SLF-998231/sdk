import type { UseDocumentFn } from '../contracts';
import { useDocumentResource } from '../provider/useDocumentResource';

/** One document (cache key `file:<id>`, shared with useDocumentText and the document page). */
export const useDocument: UseDocumentFn = (id, source) => {
  const { res, loading } = useDocumentResource(id, source);
  return { document: res.data, loading, error: res.error, offline: res.offline, stale: res.stale, refresh: res.refresh };
};
