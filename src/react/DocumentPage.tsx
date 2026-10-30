import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ShelfClient } from '../client';
import type { SwrImpl } from '../cache/swr';
import type { ThumbLoader } from '../internal/contracts';
import { ActionMenu } from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import type { DocumentTabId } from './contracts';
import { cx } from './cx';
import { ContentPanel } from './document/ContentPanel';
import { downloadOriginal, PreviewPanel } from './document/PreviewPanel';
import type { Detail } from './document/PreviewPanel';
import { CopyFeedback, TextPanel, useCopyNotice } from './document/TextPanel';
import { useSiteView } from './document/useSiteView';
import { formatDateTime, formatSize, statusPill, typeLabel } from './format';
import type { ParsedMeta } from './format';
import { PencilIcon } from './icons';
import type { SiteView } from './siteView';

export type { Detail };

export interface DocumentPageViewProps {
  client: ShelfClient;
  /** The session's SWR engine (null until the cache has opened): the site is read through it unless `siteView` is given. */
  swr: SwrImpl | null;
  /** The session's thumbnail loader (cache first), used for image previews. */
  loader: ThumbLoader | null;
  doc: Detail;
  /** Where it sits: folder names from the top, for the Location row. */
  location: string;
  folderName: string;
  /** Rename, Move and Delete: present only for a read_write key (hidden for read keys). */
  onRename?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
  /** Without it there is no "Back to" button. */
  onClose?: () => void;
  /** The site as the caller already reads it (useDocumentSite). Without it the page reads it through `swr`. */
  siteView?: SiteView;
  /** Show the Small / Medium / Large / Original bar over an image preview. Default true. */
  showPreviewSizes?: boolean;
  /** Which tabs, in what order. Default ['text', 'preview', 'content']. */
  documentTabs?: readonly DocumentTabId[];
}
/** The props ShelfFolder has always passed. */
export type DocumentPageProps = DocumentPageViewProps;

const TAB_LABEL: Record<DocumentTabId, string> = { text: 'Text', preview: 'Preview', content: 'Content' };
const DEFAULT_TABS: readonly DocumentTabId[] = ['text', 'preview', 'content'];
const PENDING: SiteView = { kind: 'pending' };
const HIDDEN: SiteView = { kind: 'hidden' };

/* ------------------------------------------------------------------ the page */

/**
 * A document, laid out like Shelf web's document page: type and size over the filename, Text / Preview (and
 * Content, when the document has a generated site) tabs, and a Details panel beside them. Download is in the
 * menu for every key; Rename, Move and Delete arrive only for a read_write key.
 */
export function DocumentPageView({ client, swr, loader, doc, location, folderName, onRename, onMove, onDelete, onClose, siteView: given, showPreviewSizes = true, documentTabs }: DocumentPageViewProps) {
  const hasSite = doc.has_site === true;
  const own = useSiteView(given ? null : swr, client, doc.id, hasSite);
  const view: SiteView = !hasSite ? HIDDEN : (given ?? own.view ?? PENDING);

  // The tabs shown: the configured ones that apply, in the configured order. Text and Preview always apply; Content
  // only with a generated site that has not failed. The page opens on the first and keeps what the reader picks
  // for as long as it is still there. If the list is empty or nothing in it applies, the default order is used.
  const applies = (t: DocumentTabId) => TAB_LABEL[t] !== undefined && (t !== 'content' || view.kind !== 'hidden');
  const listed = (documentTabs ?? DEFAULT_TABS).filter((t, i, all) => applies(t) && all.indexOf(t) === i);
  const tabs = listed.length > 0 ? listed : DEFAULT_TABS.filter(applies);
  const [chosen, setTab] = useState<DocumentTabId | null>(null);
  const tab = chosen !== null && tabs.includes(chosen) ? chosen : tabs[0]!;

  const type = typeLabel(doc.content_type);
  const status = statusPill(doc.parse_status);
  const meta = (doc.parsed_meta ?? null) as ParsedMeta | null;
  const sheets = Array.isArray(meta?.sheet_names) ? meta!.sheet_names!.join(', ') : '';

  const { notice, copyError, copy } = useCopyNotice();

  const menu: MenuAction[] = [
    ...(onMove ? [{ label: 'Move to…', onSelect: onMove }] : []),
    { label: 'Download', onSelect: () => void downloadOriginal(client, doc) },
    ...(onDelete ? [{ label: 'Delete', onSelect: onDelete, danger: true }] : []),
  ];

  // Arrow keys move between the tabs in the order shown (wrapping), Home and End to the ends; the tab arrived on opens.
  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(tab);
    const n = tabs.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabs[to]!);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };
  const tabButton = (id: DocumentTabId) => (
    <button key={id} type="button" role="tab" className={cx('shelf-tab')} aria-selected={tab === id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
      {TAB_LABEL[id]}
    </button>
  );

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
          {onRename && (
            <button type="button" className={cx('btn', 'btn--ghost', 'btn--icon', 'doc-ai-rename-btn')} title="Edit name" aria-label="Edit name" onClick={onRename}>
              <PencilIcon />
            </button>
          )}
          <ActionMenu label={doc.filename} actions={menu} />
          {onClose && (
            <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onClose}>
              Back to {folderName}
            </button>
          )}
        </div>
      </header>

      <CopyFeedback notice={notice} copyError={copyError} />

      <div className={cx('doc-layout')}>
        <section className={cx('doc-main')} aria-label="Contents">
          <div className={cx('shelf-tabs', 'doc-tabs')} role="tablist" aria-label="View" onKeyDown={onTabKeys}>
            {tabs.map(tabButton)}
          </div>
          {tab === 'content' ? (
            <ContentPanel view={view} originalUrl={client.originalUrl(doc.id, doc.filename)} />
          ) : tab === 'preview' ? (
            <PreviewPanel client={client} loader={loader} doc={doc} showPreviewSizes={showPreviewSizes} />
          ) : (
            <TextPanel text={doc.parsed_text} onCopy={(t) => void copy(t)} />
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

/** What ShelfFolder renders: the page for a document it has already read. */
export const DocumentPage = DocumentPageView;
