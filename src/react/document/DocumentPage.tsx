import { useContext, useMemo } from 'react';
import { ShelfContext } from '../context';
import type { DocumentPageProps } from '../contracts';
import { cx } from '../cx';
import { useDocument } from '../hooks/useDocument';
import { useDocumentSite } from '../hooks/useDocumentSite';
import { DocumentPageView } from '../DocumentPage';
import type { Detail } from '../DocumentPage';
import { NotConnectedRoot, ShelfRoot } from '../ShelfRoot';
import { useShelfSessionState } from '../useShelfSession';

/**
 * One document, laid out like Shelf web's document page, read through the nearest ShelfProvider or the given
 * `client` / `baseUrl`. `initial` (the listing's record) shows while the full document loads.
 */
export function DocumentPage({ documentId, initial, location, folderName, onClose, actions, showPreviewSizes, documentTabs, theme, className, ...source }: DocumentPageProps) {
  const s = useShelfSessionState(source, false);
  const defaults = useContext(ShelfContext); // the provider's page options apply when the props leave them out
  const { document: full, error } = useDocument(documentId, source);
  const doc = useMemo<Detail | undefined>(() => full ?? initial, [full, initial]);
  const { view } = useDocumentSite(documentId, { ...source, enabled: doc ? doc.has_site === true : false });
  if (!s.client) return <NotConnectedRoot theme={theme} className={className} />;
  if (!doc) {
    return (
      <ShelfRoot theme={theme} className={className}>
        {error ? (
          <p className={cx('callout', 'callout--danger')} role="alert">
            Shelf couldn&apos;t load this document.
          </p>
        ) : (
          <div className={cx('doc-body')} role="status" aria-busy="true" aria-label="Loading" />
        )}
      </ShelfRoot>
    );
  }
  return (
    <ShelfRoot theme={theme} className={className}>
      <DocumentPageView
        client={s.client}
        swr={null}
        loader={s.session?.parts?.loader ?? null}
        doc={doc}
        location={location ?? ''}
        folderName={folderName ?? 'folder'}
        onRename={actions?.rename}
        onMove={actions?.move}
        onDelete={actions?.delete}
        onClose={onClose}
        siteView={view}
        showPreviewSizes={showPreviewSizes ?? defaults?.showPreviewSizes}
        documentTabs={documentTabs ?? defaults?.documentTabs}
      />
    </ShelfRoot>
  );
}
