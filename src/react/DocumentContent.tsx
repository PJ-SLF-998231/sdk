import { DocSite } from '../docsite/DocSite';
import { cx } from './cx';
import type { SiteView } from './siteView';

/**
 * The Content tab's panel: the document's generated site, drawn from its JSON spec by the ported docsite
 * renderer (never injected as HTML). Its own chunk, fetched only when a document with a site is opened.
 */
export default function DocumentContent({ view, originalUrl }: { view: SiteView; originalUrl: string }) {
  return (
    <div className={cx('doc-content', 'doc-site-panel')} role="tabpanel" aria-busy={view.kind !== 'site' || view.updating}>
      {view.kind === 'site' ? (
        <>
          {view.updating && (
            <p className={cx('preview-muted', 'doc-site-updating')} role="status">
              Updating…
            </p>
          )}
          {view.outdated && (
            <p className={cx('preview-muted', 'doc-site-updating')} role="status">
              This page may be out of date: the document changed after it was built.
            </p>
          )}
          <DocSite
            spec={view.spec}
            originalUrl={originalUrl}
            fallback={<p className={cx('status-note')}>There&apos;s nothing to show on this page yet. The Text tab has everything Shelf read.</p>}
            onSkip={() => undefined}
          />
        </>
      ) : view.kind === 'building' ? (
        <div className={cx('callout', 'doc-status', 'doc-site-building')} role="status">
          <span className={cx('upload-bar', 'upload-bar--parsing')} aria-hidden="true" />
          Building this page… It appears here by itself.
        </div>
      ) : (
        <section className={cx('doc-panel', 'doc-text-panel', 'doc-panel--skeleton')} role="status" aria-label="Loading">
          <span className={cx('skeleton-line', 'skeleton-line--kicker')} aria-hidden="true" />
          <span className={cx('skeleton-line', 'skeleton-line--wide')} aria-hidden="true" />
          <span className={cx('skeleton-line')} aria-hidden="true" />
        </section>
      )}
    </div>
  );
}
