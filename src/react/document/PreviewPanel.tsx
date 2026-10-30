import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ShelfClient } from '../../client';
import type { ThumbLoader } from '../../internal/contracts';
import type { PreviewSize, ShelfItem } from '../../types';
import { cx } from '../cx';
import { documentKind, orderedSizes, typeLabel } from '../format';

export type Detail = ShelfItem & { parsed_text?: string | null };

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

function ImagePreview({ client, loader, doc, showSizes }: { client: ShelfClient; loader: ThumbLoader | null; doc: Detail; showSizes: boolean }) {
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
      {showSizes && sizes.length > 0 && (
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
        {src && <img className={cx('doc-image')} src={src} alt={doc.filename} decoding="async" {...(showSizes ? {} : { loading: 'lazy' as const })} />}
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
export function PreviewPanel({ client, loader, doc, showPreviewSizes = true }: { client: ShelfClient; loader: ThumbLoader | null; doc: Detail; showPreviewSizes?: boolean }) {
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
  } else if (kind === 'image') body = <ImagePreview client={client} loader={loader} doc={doc} showSizes={showPreviewSizes} />;
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
export async function downloadOriginal(client: ShelfClient, doc: Detail): Promise<void> {
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
