import type { DocumentContentTabProps } from '../contracts';
import { useDocument } from '../hooks/useDocument';
import { useDocumentSite } from '../hooks/useDocumentSite';
import { NotConnectedRoot, ShelfRoot } from '../ShelfRoot';
import { useShelfSessionState } from '../useShelfSession';
import { ContentPanel, ContentSkeleton } from './ContentPanel';

/** A document's generated site (its Content tab). `hasSite` false (or a document without one) renders nothing and fetches nothing. */
export function DocumentContentTab({ documentId, hasSite, theme, className, ...source }: DocumentContentTabProps) {
  const s = useShelfSessionState(source, false);
  const { document: doc } = useDocument(hasSite === false ? null : documentId, source);
  const { view } = useDocumentSite(documentId, { ...source, enabled: hasSite });
  if (!s.client) return <NotConnectedRoot theme={theme} className={className} />;
  // Not known yet whether there is a site: the skeleton, without fetching the renderer.
  if (view.kind === 'pending') return <ShelfRoot theme={theme} className={className}><ContentSkeleton /></ShelfRoot>;
  if (view.kind === 'hidden') return <ShelfRoot theme={theme} className={className}>{null}</ShelfRoot>;
  return (
    <ShelfRoot theme={theme} className={className}>
      <ContentPanel view={view} originalUrl={s.client.originalUrl(documentId, doc?.filename ?? '')} />
    </ShelfRoot>
  );
}
