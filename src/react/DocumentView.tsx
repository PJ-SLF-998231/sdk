import { useState } from 'react';
import type { ShelfClient } from '../client';
import type { ShelfItem } from '../types';
import { ActionMenu } from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import { cx } from './cx';
import { describeMeta, formatDateTime, formatSize, orderedSizes, statusPill, typeLabel } from './format';
import type { ParsedMeta } from './format';

export type Detail = ShelfItem & { parsed_text?: string | null };

interface Props {
  client: ShelfClient;
  doc: Detail;
  /** Where it sits: folder names from the top, for the Location row. */
  location: string;
  folderName: string;
  actions: MenuAction[];
  onClose: () => void;
}

/**
 * A document, laid out like Shelf web's document page: type and size over the filename,
 * Content/Text tabs, and a Details panel beside them. Download is always there;
 * rename, move and delete arrive as `actions` only for a read_write key.
 */
export function DocumentView({ client, doc, location, folderName, actions, onClose }: Props) {
  const sizes = orderedSizes(doc.preview_sizes);
  const medium = sizes.includes('medium') ? 'medium' : sizes[Math.floor((sizes.length - 1) / 2)];
  const hasPreview = medium !== undefined;
  const hasText = Boolean(doc.parsed_text);
  // Until a tab is chosen: the text when there is some (or no preview), else the preview. The full document arrives after the list row.
  const [chosen, setTab] = useState<'text' | 'preview' | null>(null);
  const tab = chosen ?? (hasText || !hasPreview ? 'text' : 'preview');
  const type = typeLabel(doc.content_type);
  const status = statusPill(doc.parse_status);
  const meta = (doc.parsed_meta ?? null) as ParsedMeta | null;
  const sheets = Array.isArray(meta?.sheet_names) ? meta!.sheet_names!.join(', ') : '';

  return (
    <section className={cx('doc-body')} aria-label="Document details">
      <header className={cx('page-header', 'doc-header')}>
        <div className={cx('doc-title')}>
          <p className={cx('section-eyebrow')}>
            {type} · {formatSize(doc.size_bytes)}
          </p>
          <h1 className={cx('section-title')}>{doc.filename}</h1>
        </div>
        <div className={cx('page-header-aside', 'doc-actions')}>
          <a className={cx('btn', 'btn--accent', 'btn--sm')} href={client.originalUrl(doc.id, doc.filename)} download={doc.filename}>
            Download
          </a>
          <ActionMenu label={doc.filename} actions={actions} />
          <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onClose}>
            Back to {folderName}
          </button>
        </div>
      </header>

      <div className={cx('doc-layout')}>
        <section className={cx('doc-main')} aria-label="Contents">
          <div className={cx('shelf-tabs', 'doc-tabs')} role="tablist" aria-label="View">
            <button type="button" role="tab" className={cx('shelf-tab')} aria-selected={tab === 'text'} aria-current={tab === 'text' ? 'page' : undefined} onClick={() => setTab('text')}>
              Text
            </button>
            {hasPreview && (
              <button type="button" role="tab" className={cx('shelf-tab')} aria-selected={tab === 'preview'} aria-current={tab === 'preview' ? 'page' : undefined} onClick={() => setTab('preview')}>
                Preview
              </button>
            )}
          </div>
          {tab === 'preview' && hasPreview ? (
            <div className={cx('doc-content')} role="tabpanel">
              <section className={cx('doc-panel')}>
                <img className={cx('doc-preview')} alt={`Preview of ${doc.filename}`} src={client.thumbnailUrl(doc.id, medium)} />
              </section>
            </div>
          ) : (
            <div className={cx('doc-content')} role="tabpanel">
              <section className={cx('doc-panel', 'doc-text-panel')}>
                <div className={cx('doc-panel-head')}>
                  <div>
                    <h2 className={cx('kicker')}>Full text</h2>
                  </div>
                </div>
                {hasText ? (
                  <pre className={cx('doc-text')}>{doc.parsed_text}</pre>
                ) : (
                  <p className={cx('status-note')}>The text appears here once Shelf has read the file.</p>
                )}
              </section>
            </div>
          )}
        </section>

        <aside className={cx('doc-aside', 'is-open')} aria-label="Details">
          <div className={cx('doc-aside-body')}>
            <section className={cx('doc-panel')}>
              <h2 className={cx('kicker')}>Details</h2>
              <dl className={cx('preview-facts')}>
                <dt>Type</dt>
                <dd>{type}</dd>
                <dt>Size</dt>
                <dd>{formatSize(doc.size_bytes)}</dd>
                {meta?.page_count ? (
                  <>
                    <dt>Pages</dt>
                    <dd>{meta.page_count}</dd>
                  </>
                ) : null}
                {meta?.word_count ? (
                  <>
                    <dt>Words</dt>
                    <dd>{meta.word_count.toLocaleString()}</dd>
                  </>
                ) : null}
                {sheets ? (
                  <>
                    <dt>Sheets</dt>
                    <dd>{sheets}</dd>
                  </>
                ) : null}
                <dt>Location</dt>
                <dd>{location}</dd>
                {status && (
                  <>
                    <dt>Status</dt>
                    <dd>{status.label}</dd>
                  </>
                )}
                <dt>Uploaded</dt>
                <dd>{formatDateTime(doc.created_at)}</dd>
                {doc.parsed_at && (
                  <>
                    <dt>Read</dt>
                    <dd>{formatDateTime(doc.parsed_at)}</dd>
                  </>
                )}
                {doc.edited_at && (
                  <>
                    <dt>Edited</dt>
                    <dd>{formatDateTime(doc.edited_at)}</dd>
                  </>
                )}
              </dl>
            </section>
          </div>
        </aside>
      </div>
    </section>
  );
}
