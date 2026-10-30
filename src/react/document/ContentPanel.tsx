import { lazy, Suspense } from 'react';
import type { SiteView } from '../siteView';
import { cx } from '../cx';

/** The document-site renderer is its own chunk, fetched only for a document that has a site. */
const DocumentContent = lazy(() => import('../DocumentContent'));

export function ContentSkeleton() {
  return (
    <div className={cx('doc-content')} role="status" aria-busy="true" aria-label="Loading">
      <section className={cx('doc-panel', 'doc-text-panel', 'doc-panel--skeleton')} aria-hidden="true">
        <span className={cx('skeleton-line', 'skeleton-line--kicker')} />
        <span className={cx('skeleton-line', 'skeleton-line--wide')} />
        <span className={cx('skeleton-line')} />
      </section>
    </div>
  );
}

/** The Content tab's panel, its renderer fetched on first use. */
export function ContentPanel({ view, originalUrl }: { view: SiteView; originalUrl: string }) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <DocumentContent view={view} originalUrl={originalUrl} />
    </Suspense>
  );
}
