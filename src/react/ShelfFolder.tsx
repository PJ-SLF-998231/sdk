import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { createShelfClient, ShelfError } from '../client';
import type { ShelfClient } from '../client';
import type { ShelfFolder as FolderRecord, ShelfItem } from '../types';

export interface ShelfFolderProps {
  /** A ready client. Takes precedence over `baseUrl`. */
  client?: ShelfClient;
  /** Integration API base URL (for example a same-origin proxy such as /api/shelf). */
  baseUrl?: string;
  /** Folder to open first, and the top of the breadcrumb. Defaults to the key's folder. */
  initialFolderId?: string;
  /** `auto` (default) follows the OS setting. */
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
}

type Detail = ShelfItem & { parsed_text?: string | null };

const PAGE = 50;
const SIZE_ORDER = ['small', 'medium', 'large'];

/** Preview size names, smallest first; unknown names last. Tolerates null/undefined. */
function orderedSizes(sizes: ReadonlyArray<string | number> | null | undefined): string[] {
  const rank = (s: string) => (SIZE_ORDER.includes(s) ? SIZE_ORDER.indexOf(s) : SIZE_ORDER.length);
  return (Array.isArray(sizes) ? sizes.map(String) : []).sort((a, b) => rank(a) - rank(b));
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1, i + 5) : 'file';
}

function describe(err: unknown, action: string): string {
  if (err instanceof ShelfError) {
    if (err.status === 413) return `${action}: the file is too large.`;
    if (err.status === 415) return `${action}: this file type is not supported.`;
    return `${action}: ${err.message}`;
  }
  return `${action}: ${err instanceof Error ? err.message : 'something went wrong'}`;
}

export function ShelfFolder({ client: given, baseUrl, initialFolderId, theme = 'auto', className }: ShelfFolderProps) {
  const client = useMemo<ShelfClient | null>(
    () => given ?? (baseUrl ? createShelfClient({ baseUrl }) : null),
    [given, baseUrl],
  );
  const [notConfigured, setNotConfigured] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [rootId, setRootId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [files, setFiles] = useState<ShelfItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [over, setOver] = useState(false);
  const seq = useRef(0);
  const picker = useRef<HTMLInputElement>(null);

  const fail = useCallback((err: unknown, action: string): boolean => {
    if (err instanceof ShelfError && err.code === 'not_configured') {
      setNotConfigured(true);
      return true;
    }
    setError(describe(err, action));
    return false;
  }, []);

  // Bootstrap: access level and the folder tree.
  useEffect(() => {
    if (!client) return;
    let live = true;
    setNotConfigured(false);
    setReady(false);
    (async () => {
      try {
        const [info, all] = await Promise.all([client.info(), client.folders()]);
        if (!live) return;
        setCanWrite(info.access === 'read_write');
        const list = Array.isArray(all) ? all : [];
        setFolders(list);
        const ids = new Set(list.map((f) => f.id));
        const tops = list.filter((f) => !f.parent_id || !ids.has(f.parent_id));
        const start = initialFolderId ?? (tops.length === 1 ? tops[0]!.id : null);
        setRootId(start);
        setCurrentId(start);
        setReady(true);
      } catch (err) {
        if (live) fail(err, 'Could not load Shelf');
      }
    })();
    return () => {
      live = false;
    };
  }, [client, initialFolderId, fail]);

  const loadFiles = useCallback(
    async (folderId: string | null, after?: string | null) => {
      if (!client) return;
      const mine = ++seq.current;
      setLoading(true);
      try {
        const res = await client.listFiles({
          ...(folderId ? { folder_id: folderId } : {}),
          recursive: false,
          limit: PAGE,
          ...(after ? { cursor: after } : {}),
        });
        if (mine !== seq.current) return;
        const rows = Array.isArray(res?.items) ? res.items : [];
        setFiles((prev) => (after ? [...prev, ...rows] : rows));
        setCursor(res?.next_cursor ?? null);
        setError(null);
      } catch (err) {
        if (mine === seq.current) fail(err, 'Could not load files');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [client, fail],
  );

  useEffect(() => {
    if (!ready) return;
    setSelected(null);
    setFiles([]);
    setCursor(null);
    void loadFiles(currentId);
  }, [ready, currentId, loadFiles]);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const subfolders = useMemo(() => {
    if (currentId) return folders.filter((f) => f.parent_id === currentId);
    return folders.filter((f) => !f.parent_id || !byId.has(f.parent_id));
  }, [folders, currentId, byId]);
  const crumbs = useMemo(() => {
    const out: FolderRecord[] = [];
    let id = currentId;
    while (id) {
      const f = byId.get(id);
      if (!f) break;
      out.unshift(f);
      if (id === rootId) break;
      id = f.parent_id ?? null;
    }
    return out;
  }, [currentId, rootId, byId]);

  const open = async (f: ShelfItem) => {
    if (!client) return;
    setSelected(f);
    try {
      const full = await client.getFile(f.id);
      setSelected((cur) => (cur && cur.id === f.id ? full : cur));
    } catch (err) {
      fail(err, 'Could not load the document');
    }
  };

  const upload = async (list: FileList | File[]) => {
    if (!client) return;
    const msgs: string[] = [];
    for (const file of Array.from(list)) {
      try {
        await client.upload(file, currentId ? { folder_id: currentId } : {});
      } catch (err) {
        if (err instanceof ShelfError && err.code === 'not_configured') return void setNotConfigured(true);
        msgs.push(describe(err, `Could not upload ${file.name}`));
      }
    }
    setNotices(msgs);
    await loadFiles(currentId);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer?.files?.length) void upload(e.dataTransfer.files);
  };

  const rootClass = ['shelf-sdk', className].filter(Boolean).join(' ');
  const themeAttr = theme === 'auto' ? undefined : theme;

  if (!client || notConfigured) {
    return (
      <div className={rootClass} data-theme={themeAttr}>
        <div className="shelf-sdk__notice" role="alert">
          <strong>Shelf isn&apos;t connected</strong>
          The document store is not set up for this site yet.
        </div>
      </div>
    );
  }

  const row = (key: string, children: ReactNode, onClick: () => void, pressed?: boolean) => (
    <li key={key}>
      <button type="button" className="shelf-sdk__row" onClick={onClick} aria-pressed={pressed}>
        {children}
      </button>
    </li>
  );

  return (
    <div className={rootClass} data-theme={themeAttr}>
      <nav aria-label="Folder path">
        <ol className="shelf-sdk__crumbs" style={{ listStyle: 'none', padding: 0 }}>
          {crumbs.length === 0 && <li>Files</li>}
          {crumbs.map((c, i) => (
            <li key={c.id}>
              {i > 0 && <span aria-hidden="true"> / </span>}
              <button
                type="button"
                className="shelf-sdk__crumb"
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                onClick={() => setCurrentId(c.id)}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {canWrite && (
        <div
          className="shelf-sdk__drop"
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          data-testid="shelf-dropzone"
        >
          Drop files here or{' '}
          <button type="button" className="shelf-sdk__btn" onClick={() => picker.current?.click()}>
            Choose files
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            aria-label="Upload files"
            className="shelf-sdk__sr"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {notices.map((n) => (
        <p key={n} className="shelf-sdk__error" role="alert">
          {n}
        </p>
      ))}
      {error && (
        <p className="shelf-sdk__error" role="alert">
          {error}
        </p>
      )}

      {(subfolders.length > 0 || files.length > 0) && (
        <ul className="shelf-sdk__list" aria-label="Folder contents">
          {subfolders.map((f) =>
            row(
              `d-${f.id}`,
              <>
                <span className="shelf-sdk__thumb" aria-hidden="true">dir</span>
                <span className="shelf-sdk__name">{f.name}</span>
              </>,
              () => setCurrentId(f.id),
            ),
          )}
          {files.map((f) =>
            row(
              `f-${f.id}`,
              <>
                {orderedSizes(f.preview_sizes).length ? (
                  <img
                    className="shelf-sdk__thumb"
                    alt=""
                    loading="lazy"
                    src={client.thumbnailUrl(f.id, orderedSizes(f.preview_sizes)[0])}
                  />
                ) : (
                  <span className="shelf-sdk__thumb" aria-hidden="true">{ext(f.filename)}</span>
                )}
                <span className="shelf-sdk__name">{f.filename}</span>
                <span className="shelf-sdk__meta">{formatSize(f.size_bytes)}</span>
                <span className="shelf-sdk__meta">{formatDate(f.created_at)}</span>
              </>,
              () => void open(f),
              selected?.id === f.id,
            ),
          )}
        </ul>
      )}
      {ready && !loading && subfolders.length === 0 && files.length === 0 && !error && (
        <p className="shelf-sdk__empty">This folder is empty.</p>
      )}
      {loading && <p className="shelf-sdk__empty">Loading...</p>}
      {cursor && !loading && (
        <button type="button" className="shelf-sdk__btn shelf-sdk__more" onClick={() => void loadFiles(currentId, cursor)}>
          Load more
        </button>
      )}

      {selected && (
        <DocumentPanel
          key={selected.id}
          client={client}
          doc={selected}
          canWrite={canWrite}
          folders={folders}
          onClose={() => setSelected(null)}
          onFail={fail}
          onRenamed={(u) => {
            setSelected((s) => (s ? { ...s, ...u } : s));
            setFiles((fs) => fs.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
          }}
          onGone={(id) => {
            setSelected(null);
            setFiles((fs) => fs.filter((x) => x.id !== id));
          }}
        />
      )}
    </div>
  );
}

interface PanelProps {
  client: ShelfClient;
  doc: Detail;
  canWrite: boolean;
  folders: FolderRecord[];
  onClose: () => void;
  onFail: (err: unknown, action: string) => boolean;
  onRenamed: (item: ShelfItem) => void;
  onGone: (id: string) => void;
}

function DocumentPanel({ client, doc, canWrite, folders, onClose, onFail, onRenamed, onGone }: PanelProps) {
  const [mode, setMode] = useState<'view' | 'rename' | 'move' | 'delete'>('view');
  const [name, setName] = useState(doc.filename);
  const [target, setTarget] = useState(doc.folder_id ?? folders[0]?.id ?? '');
  const sizes = orderedSizes(doc.preview_sizes);
  const medium = sizes.includes('medium') ? 'medium' : sizes[Math.floor((sizes.length - 1) / 2)];

  const run = async (fn: () => Promise<void>, action: string) => {
    try {
      await fn();
      setMode('view');
    } catch (err) {
      onFail(err, action);
    }
  };

  return (
    <section className="shelf-sdk__panel" aria-label="Document details">
      <h3>{doc.filename}</h3>
      {medium !== undefined && (
        <img className="shelf-sdk__preview" alt={`Preview of ${doc.filename}`} src={client.thumbnailUrl(doc.id, medium)} />
      )}
      <dl className="shelf-sdk__details">
        <dt>Type</dt>
        <dd>{doc.content_type}</dd>
        <dt>Size</dt>
        <dd>{formatSize(doc.size_bytes)}</dd>
        <dt>Added</dt>
        <dd>{formatDate(doc.created_at)}</dd>
        {doc.edited_at && (
          <>
            <dt>Edited</dt>
            <dd>{formatDate(doc.edited_at)}</dd>
          </>
        )}
        <dt>Text</dt>
        <dd>{doc.parse_status}</dd>
      </dl>
      {doc.parsed_text ? <pre className="shelf-sdk__text">{doc.parsed_text}</pre> : null}

      {mode === 'rename' && (
        <form
          className="shelf-sdk__actions"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => onRenamed(await client.updateFile(doc.id, { filename: name.trim() })), 'Could not rename');
          }}
        >
          <label>
            <span className="shelf-sdk__sr">New name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" />
          </label>
          <button type="submit" className="shelf-sdk__btn shelf-sdk__btn--primary" disabled={!name.trim()}>
            Save name
          </button>
          <button type="button" className="shelf-sdk__btn" onClick={() => setMode('view')}>
            Cancel
          </button>
        </form>
      )}
      {mode === 'move' && (
        <form
          className="shelf-sdk__actions"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await client.updateFile(doc.id, { folder_id: target });
              onGone(doc.id);
            }, 'Could not move');
          }}
        >
          <label>
            <span className="shelf-sdk__sr">Destination folder</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Destination folder">
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="shelf-sdk__btn shelf-sdk__btn--primary">
            Move here
          </button>
          <button type="button" className="shelf-sdk__btn" onClick={() => setMode('view')}>
            Cancel
          </button>
        </form>
      )}
      {mode === 'delete' && (
        <div className="shelf-sdk__actions" role="alertdialog" aria-label="Confirm delete">
          <span>Delete {doc.filename}? This cannot be undone.</span>
          <button
            type="button"
            className="shelf-sdk__btn shelf-sdk__btn--danger"
            onClick={() =>
              void run(async () => {
                await client.deleteFile(doc.id);
                onGone(doc.id);
              }, 'Could not delete')
            }
          >
            Confirm delete
          </button>
          <button type="button" className="shelf-sdk__btn" onClick={() => setMode('view')}>
            Cancel
          </button>
        </div>
      )}
      {mode === 'view' && (
        <div className="shelf-sdk__actions">
          <a className="shelf-sdk__btn shelf-sdk__btn--primary" href={client.originalUrl(doc.id, doc.filename)} download={doc.filename}>
            Download
          </a>
          {canWrite && (
            <>
              <button type="button" className="shelf-sdk__btn" onClick={() => setMode('rename')}>
                Rename
              </button>
              <button type="button" className="shelf-sdk__btn" onClick={() => setMode('move')}>
                Move
              </button>
              <button type="button" className="shelf-sdk__btn shelf-sdk__btn--danger" onClick={() => setMode('delete')}>
                Delete
              </button>
            </>
          )}
          <button type="button" className="shelf-sdk__btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </section>
  );
}
