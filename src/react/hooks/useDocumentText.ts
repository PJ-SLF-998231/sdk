import type { UseDocumentTextFn } from '../contracts';
import { useDocumentResource } from '../provider/useDocumentResource';

/** The document's extracted text; the same cache entry as useDocument, so asking for both costs one request. */
export const useDocumentText: UseDocumentTextFn = (id, source) => {
  const { res, loading } = useDocumentResource(id, source);
  return { text: res.data?.parsed_text ?? undefined, loading, error: res.error };
};
