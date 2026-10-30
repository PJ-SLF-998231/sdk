import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { deepEqual } from '../cache/reconcile';
import type { ShelfClient } from '../client';
import type { SwrImpl } from '../cache/swr';
import { copyToClipboard } from '../docsite/copyToClipboard';
import { useResource } from '../hooks/useResource';
import type { ThumbLoader } from '../internal/contracts';
import type { PreviewSize, ShelfItem, ShelfSite } from '../types';
import { ActionMenu } from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import { cx } from './cx';
import { documentKind, formatDateTime, formatSize, orderedSizes, statusPill, typeLabel } from './format';
import type { ParsedMeta } from './format';
import { PencilIcon } from './icons';
import { siteView } from './siteView';

export type Detail = ShelfItem & { parsed_text?: string | null };

/** The Content tab's renderer (the document-site blocks) is its own chunk, fetched only for a document with a site. */
const DocumentContent = lazy(() => import('./DocumentContent'));

export interface DocumentPageProps {
  client: ShelfClient;
  /** The session's SWR engine (null until the cache has opened): the site is read through it. */
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
  onClose: () => void;
}

type Tab = 'text' | 'preview' | 'content';

const SITE_POLL_MS = 2500;
const mergeSame = <T,>(prev: T | undefined, next: T): T => (prev !== undefined && deepEqual(prev, next) ? prev : next);

/* ------------------------------------------------------------------ the original, read with the client's credentials */

interface OriginalState {
  url: string | null;
  loading: boolean;
  failed: boolean;
}

/**
 * The original file as an object URL, fetched only while `enabled` (the Preview tab is open) and aborted/revoked
 * when it is not. A client without `original()` hands back its own original route instead.
 * `forceType` pins the blob's type, so a server answering with something else (HTML, say) is never rendered as it.
 */
function useOriginal(client: ShelfClient, doc: Detail, enabled: boolean, forceType: string | null): OriginalState {
  const [state, setState] = useState<OriginalState & { key: string }>({ key: '', url: null, loading: false, failed: false });
  const key = `${doc.id}|${doc.edited_at ?? ''}|${doc.filename}`;
  useEffect(() => {
    if (!enabled) return;
    if (typeof client.original !== 'function') {
      setState({ key, url: client.originalUrl(doc.id, doc.filename), loading: false, failed: false });
      return;
    }
    const ac = new AbortController();
    let objectUrl: string | null = null;
    setState({ key, url: null, loading: true, failed: false });
    client
      .original(doc.id, doc.filename, { signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return;
        const type = forceType ?? (res.type.startsWith('image/') ? res.type : 'application/octet-stream');
        objectUrl = URL.createObjectURL(new Blob([res.bytes], { type }));
        setState({ key, url: objectUrl, loading: false, failed: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ key, url: null, loading: false, failed: true });
      });
    return () => {
      ac.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, doc.id, doc.filename, key, enabled, forceType]);
  return state.key === key ? state : { url: null, loading: enabled, failed: false };
}

/** One thumbnail through the shared loader (blob cache, If-None-Match); null while loading or when there is none. */
function useThumbUrl(loader: ThumbLoader | null, id: string, size: PreviewSize | null, version: string | null | undefined): string | null {
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${id}|${size}|${version ?? ''}`;
  const peeked = loader && size ? loader.peek(id, size) : null;
  useEffect(() => {
    if (!loader || !size || peeked) return;
    const ac = new AbortController();
    loader
      .load({ id, size, version, signal: ac.signal })
      .then((url) => {
        if (!ac.signal.aborted) setLoaded({ key, url });
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoaded({ key, url: null });
      });
    return () => ac.abort();
  }, [loader, id, size, version, key, peeked]);
  return peeked ?? (loaded?.key === key ? loaded.url : null);
}

function OriginalLoading() {
  return (
    <div className={cx('doc-original-loading')}>
      <div className={cx('progress', 'progress--indeterminate')} role="progressbar" aria-label="Opening the original">
        <div className={cx('progress-fill')} />
      </div>
      <p className={cx('doc-original-loading-text')}>
        <span>Opening the original…</span>
      </p>
    </div>
  );
}

function Placeholder({ doc, client, children }: { doc: Detail; client: ShelfClient; children: ReactNode }) {
  return (
    <div className={cx('preview-placeholder')}>
      <span className={cx('file-card-type')}>{typeLabel(doc.content_type)}</span>
      {children}
      <button type="button" className={cx('btn', 'btn--accent', 'btn--sm')} onClick={() => void downloadOriginal(client, doc)}>
        Download {doc.filename}
      </button>
    </div>
  );
}

const IMAGE_SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

function ImagePreview({ client, loader, doc }: { client: ShelfClient; loader: ThumbLoader | null; doc: Detail }) {
  const sizes = orderedSizes(doc.preview_sizes).filter((s): s is PreviewSize => s === 'small' || s === 'medium' || s === 'large');
  const [choice, setChoice] = useState<'original' | PreviewSize>('original');
  // While the original arrives (or when a size is chosen) the thumbnail in that size shows; the largest stands in.
  const thumbSize = choice === 'original' ? (sizes[sizes.length - 1] ?? null) : choice;
  const thumb = useThumbUrl(loader, doc.id, thumbSize, doc.edited_at);
  const original = useOriginal(client, doc, choice === 'original', null);
  const src = choice === 'original' ? (original.url ?? thumb) : thumb;
  const failed = choice === 'original' ? original.failed && !thumb : thumbSize === null;
  if (failed) {
    return (
      <Placeholder doc={doc} client={client}>
        <p>Shelf couldn&apos;t load the file.</p>
      </Placeholder>
    );
  }
  const loading = !src || (choice === 'original' && original.loading && !thumb);
  return (
    <>
      {sizes.length > 0 && (
        <div className={cx('layout-toggle')} role="group" aria-label="Image size">
          {sizes.map((s) => (
            <button key={s} type="button" className={cx('layout-toggle-btn')} aria-pressed={choice === s} onClick={() => setChoice(s)}>
              {IMAGE_SIZE_LABEL[s] ?? s}
            </button>
          ))}
          <button type="button" className={cx('layout-toggle-btn')} aria-pressed={choice === 'original'} onClick={() => setChoice('original')}>
            Original
          </button>
        </div>
      )}
      <div className={cx('doc-original-view', loading && 'is-loading')} aria-busy={loading || undefined}>
        {loading && <OriginalLoading />}
        {src && <img className={cx('doc-image')} src={src} alt={doc.filename} decoding="async" />}
      </div>
    </>
  );
}

function PdfPreview({ client, doc }: { client: ShelfClient; doc: Detail }) {
  const original = useOriginal(client, doc, true, 'application/pdf');
  const [shown, setShown] = useState(false);
  // Some browsers never fire load for a PDF handed to their viewer: stop hiding the frame after a moment.
  useEffect(() => {
    if (!original.url) return;
    const t = setTimeout(() => setShown(true), 2500);
    return () => clearTimeout(t);
  }, [original.url]);
  if (original.failed) {
    return (
      <Placeholder doc={doc} client={client}>
        <p>Shelf couldn&apos;t load the file.</p>
      </Placeholder>
    );
  }
  const loading = !original.url || !shown;
  return (
    <div className={cx('doc-original-view', loading && 'is-loading')} aria-busy={loading || undefined}>
      {loading && <OriginalLoading />}
      {original.url && (
        // PDF open parameters: fit the page width and hide the thumbnail pane. A blob typed application/pdf by us,
        // so the browser's PDF viewer shows it whatever the server answered with.
        <iframe className={cx('doc-frame')} src={`${original.url}#view=FitH&navpanes=0`} title={doc.filename} onLoad={() => setShown(true)} />
      )}
    </div>
  );
}

/** The original, where the browser can show it: images and PDFs from the original route, text from what Shelf stored. */
function PreviewPanel({ client, loader, doc }: { client: ShelfClient; loader: ThumbLoader | null; doc: Detail }) {
  const kind = documentKind(doc.content_type);
  let body: ReactNode;
  if (kind === 'text' || kind === 'markdown' || kind === 'json') {
    body = doc.parsed_text ? (
      <div className={cx('doc-original-text')}>
        <pre className={cx('doc-text')}>{kind === 'json' ? prettyJson(doc.parsed_text) : doc.parsed_text}</pre>
      </div>
    ) : (
      <div className={cx('preview-placeholder')}>
        <p>This document has no text to show yet.</p>
      </div>
    );
  } else if (kind === 'image') body = <ImagePreview client={client} loader={loader} doc={doc} />;
  else if (kind === 'pdf') body = <PdfPreview client={client} doc={doc} />;
  else {
    body = (
      <Placeholder doc={doc} client={client}>
        <p>Browsers can&apos;t display Word or Excel files. The Text tab shows everything Shelf read from it.</p>
      </Placeholder>
    );
  }
  return (
    <div className={cx('doc-original')} role="tabpanel">
      {body}
    </div>
  );
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Saves the original under its name, reading it with the client's credentials where the client can. */
async function downloadOriginal(client: ShelfClient, doc: Detail): Promise<void> {
  let href = client.originalUrl(doc.id, doc.filename);
  let objectUrl: string | null = null;
  if (typeof client.original === 'function') {
    try {
      const res = await client.original(doc.id, doc.filename);
      objectUrl = URL.createObjectURL(new Blob([res.bytes], { type: doc.content_type || 'application/octet-stream' }));
      href = objectUrl;
    } catch {
      // Fall back to the plain route: a proxy that adds the key answers it, a failure shows the browser's own error.
    }
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = doc.filename;
  a.rel = 'noopener';
  a.click();
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 10_000);
}

/* ------------------------------------------------------------------ the page */

/**
 * A document, laid out like Shelf web's document page: type and size over the filename, Text / Preview (and
 * Content, when the document has a generated site) tabs, and a Details panel beside them. Download is in the
 * menu for every key; Rename, Move and Delete arrive only for a read_write key.
 */
export function DocumentPage({ client, swr, loader, doc, location, folderName, onRename, onMove, onDelete, onClose }: DocumentPageProps) {
  const hasSite = doc.has_site === true;
  const siteRes = useResource<ShelfSite>(
    swr,
    useMemo(
      () =>
        swr && hasSite
          ? { key: `site:${doc.id}`, merge: mergeSame, fetcher: (signal: AbortSignal) => client.getSite(doc.id, { signal }) }
          : null,
      [swr, client, hasSite, doc.id],
    ),
  );
  const view = hasSite ? siteView(siteRes.data, siteRes.data === undefined && siteRes.error !== undefined) : { kind: 'hidden' as const };
  const hasContentTab = view.kind !== 'hidden';

  // While the API builds the site, check back.
  const building = hasSite && siteRes.data?.status === 'building';
  const { refresh: refreshSite, loading: checkingSite } = siteRes;
  useEffect(() => {
    if (!building || checkingSite) return;
    const t = setTimeout(() => void refreshSite(), SITE_POLL_MS);
    return () => clearTimeout(t);
  }, [building, checkingSite, siteRes.data, refreshSite]);

  // The tab picked on this page; the page opens on Text. A Content tab picked that has gone (its build failed) falls back to Text.
  const [chosen, setTab] = useState<Tab>('text');
  const tab: Tab = chosen === 'content' && !hasContentTab ? 'text' : chosen;

  const type = typeLabel(doc.content_type);
  const status = statusPill(doc.parse_status);
  const meta = (doc.parsed_meta ?? null) as ParsedMeta | null;
  const sheets = Array.isArray(meta?.sheet_names) ? meta!.sheet_names!.join(', ') : '';
  const hasText = Boolean(doc.parsed_text);

  const [notice, setNotice] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const copyText = useCallback(async () => {
    const ok = await copyToClipboard(doc.parsed_text ?? '');
    setNotice(ok ? 'Copied the text.' : null);
    setCopyError(ok ? null : "Your browser didn't allow copying. Select the text and copy it instead.");
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, [doc.parsed_text]);

  const menu: MenuAction[] = [
    ...(onMove ? [{ label: 'Move to…', onSelect: onMove }] : []),
    { label: 'Download', onSelect: () => void downloadOriginal(client, doc) },
    ...(onDelete ? [{ label: 'Delete', onSelect: onDelete, danger: true }] : []),
  ];

  const tabButton = (id: Tab, label: string) => (
    <button type="button" role="tab" className={cx('shelf-tab')} aria-selected={tab === id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
      {label}
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
          <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onClose}>
            Back to {folderName}
          </button>
        </div>
      </header>

      <div aria-live="polite">{notice && <p className={cx('callout', 'notice')}>{notice}</p>}</div>
      {copyError && (
        <p className={cx('callout', 'callout--danger')} role="alert">
          {copyError}
        </p>
      )}

      <div className={cx('doc-layout')}>
        <section className={cx('doc-main')} aria-label="Contents">
          <div className={cx('shelf-tabs', 'doc-tabs')} role="tablist" aria-label="View">
            {tabButton('text', 'Text')}
            {tabButton('preview', 'Preview')}
            {hasContentTab && tabButton('content', 'Content')}
          </div>
          {tab === 'content' ? (
            <Suspense
              fallback={
                <div className={cx('doc-content')} role="status" aria-busy="true" aria-label="Loading">
                  <section className={cx('doc-panel', 'doc-text-panel', 'doc-panel--skeleton')} aria-hidden="true">
                    <span className={cx('skeleton-line', 'skeleton-line--kicker')} />
                    <span className={cx('skeleton-line', 'skeleton-line--wide')} />
                    <span className={cx('skeleton-line')} />
                  </section>
                </div>
              }
            >
              <DocumentContent view={view} originalUrl={client.originalUrl(doc.id, doc.filename)} />
            </Suspense>
          ) : tab === 'preview' ? (
            <PreviewPanel client={client} loader={loader} doc={doc} />
          ) : (
            <div className={cx('doc-content')} role="tabpanel">
              <section className={cx('doc-panel', 'doc-text-panel')}>
                <div className={cx('doc-panel-head')}>
                  <div>
                    <h2 className={cx('kicker')}>Full text</h2>
                  </div>
                  {hasText && (
                    <div className={cx('doc-panel-actions')}>
                      <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={() => void copyText()}>
                        Copy
                      </button>
                    </div>
                  )}
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
