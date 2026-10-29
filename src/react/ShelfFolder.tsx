import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { createShelfClient, ShelfError } from '../client';
import type { ShelfClient } from '../client';
import type { ShelfFolder as FolderRecord, ShelfItem } from '../types';
import { ActionDialog } from './ActionDialog';
import type { Pending } from './ActionDialog';
import { ActionMenu } from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import { cx } from './cx';
import { DocumentView } from './DocumentView';
import type { Detail } from './DocumentView';
import { FolderTree } from './FolderTree';
import {
  describeContents,
  describeMeta,
  documentKind,
  formatDate,
  formatSize,
  orderedSizes,
  plural,
  statusPill,
  typeLabel,
  UPLOAD_ACCEPT,
  UPLOAD_LIMITS,
} from './format';
import type { ParsedMeta } from './format';
import { FolderIcon, GridIcon, ListIcon } from './icons';

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

type Layout = 'grid' | 'list';

/** Remembered per browser, like Shelf web's `shelf.layout`: a convenience, not something to sync. */
export const LAYOUT_KEY = 'shelf-sdk.layout';
export const TREE_KEY = 'shelf-sdk.folderTree';

const PAGE = 50;
/** The whole-integration census (document counts) reads at most this many pages of CENSUS_PAGE; a bigger folder shows no counts rather than a wrong one. */
const CENSUS_PAGE = 200;
const CENSUS_MAX_PAGES = 5;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and locked-down hosts can refuse storage; it still works, it just isn't remembered.
  }
}

function describe(err: unknown, action: string): string {
  if (err instanceof ShelfError) {
    if (err.status === 413) return `${action}: the file is too large.`;
    if (err.status === 415) return `${action}: this file type is not supported.`;
    return `${action}: ${err.message}`;
  }
  return `${action}: ${err instanceof Error ? err.message : 'something went wrong'}`;
}

interface Census {
  /** Documents directly in each folder. */
  direct: Map<string, number>;
  total: number;
}

export function ShelfFolder({ client: given, baseUrl, initialFolderId, theme = 'auto', className }: ShelfFolderProps) {
  const client = useMemo<ShelfClient | null>(
    () => given ?? (baseUrl ? createShelfClient({ baseUrl }) : null),
    [given, baseUrl],
  );
  const [notConfigured, setNotConfigured] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [census, setCensus] = useState<Census | null>(null);
  const [ready, setReady] = useState(false);
  const [rootId, setRootId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [files, setFiles] = useState<ShelfItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(0);
  const [layout, setLayoutState] = useState<Layout>(() => (readStore(LAYOUT_KEY) === 'list' ? 'list' : 'grid'));
  const [treeOpen, setTreeOpen] = useState<boolean>(() => readStore(TREE_KEY) === 'open');
  const seq = useRef(0);
  const picker = useRef<HTMLInputElement>(null);

  const setLayout = (next: Layout) => {
    setLayoutState(next);
    writeStore(LAYOUT_KEY, next);
  };
  const toggleTree = () => {
    const next = !treeOpen;
    setTreeOpen(next);
    writeStore(TREE_KEY, next ? 'open' : 'closed');
  };

  const fail = useCallback((err: unknown, action: string): boolean => {
    if (err instanceof ShelfError && err.code === 'not_configured') {
      setNotConfigured(true);
      return true;
    }
    setError(describe(err, action));
    return false;
  }, []);

  // Document counts for the folder cards and the header: every document under the key's folder, counted by folder.
  const loadCensus = useCallback(async () => {
    if (!client) return;
    try {
      const direct = new Map<string, number>();
      let total = 0;
      let after: string | undefined;
      for (let page = 0; page < CENSUS_MAX_PAGES; page++) {
        const res = await client.listFiles({ recursive: true, limit: CENSUS_PAGE, ...(after ? { cursor: after } : {}) });
        for (const f of Array.isArray(res?.items) ? res.items : []) {
          total += 1;
          if (f.folder_id) direct.set(f.folder_id, (direct.get(f.folder_id) ?? 0) + 1);
        }
        if (!res?.next_cursor) {
          setCensus({ direct, total });
          return;
        }
        after = res.next_cursor;
      }
      setCensus(null); // too many to count here: no counts rather than wrong ones
    } catch {
      setCensus(null);
    }
  }, [client]);

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
        void loadCensus();
      } catch (err) {
        if (live) fail(err, 'Could not load Shelf');
      }
    })();
    return () => {
      live = false;
    };
  }, [client, initialFolderId, fail, loadCensus]);

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
    setPending(null);
    setFiles([]);
    setCursor(null);
    void loadFiles(currentId);
  }, [ready, currentId, loadFiles]);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const childrenOf = useCallback(
    (parent: string | null) =>
      (parent
        ? folders.filter((f) => f.parent_id === parent)
        : folders.filter((f) => !f.parent_id || !byId.has(f.parent_id))
      )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, byId],
  );
  const subfolders = useMemo(() => childrenOf(currentId), [childrenOf, currentId]);
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

  // Documents at any depth under each folder, from the census (null while unknown).
  const totals = useMemo<Map<string, number> | null>(() => {
    if (!census) return null;
    const out = new Map<string, number>();
    const sum = (id: string): number => {
      const hit = out.get(id);
      if (hit !== undefined) return hit;
      let n = census.direct.get(id) ?? 0;
      for (const c of folders) if (c.parent_id === id) n += sum(c.id);
      out.set(id, n);
      return n;
    };
    for (const f of folders) sum(f.id);
    return out;
  }, [census, folders]);

  const currentName = (currentId ? byId.get(currentId)?.name : undefined) ?? (rootId ? byId.get(rootId)?.name : undefined) ?? 'this folder';
  const rootName = (rootId ? byId.get(rootId)?.name : undefined) ?? 'Files';
  const hasFolders = rootId === null ? folders.length > 0 : folders.some((f) => f.id !== rootId);

  const locationOf = (item: ShelfItem): string => {
    const names: string[] = [];
    let id: string | null = item.folder_id ?? null;
    while (id) {
      const f = byId.get(id);
      if (!f) break;
      names.unshift(f.name);
      if (id === rootId) break;
      id = f.parent_id ?? null;
    }
    return names.join(' / ') || rootName;
  };

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

  const refresh = async () => {
    await Promise.all([loadFiles(currentId), loadCensus()]);
  };

  const upload = async (list: FileList | File[]) => {
    if (!client) return;
    const batch = Array.from(list);
    const msgs: string[] = [];
    setAdding((n) => n + batch.length);
    for (const file of batch) {
      try {
        await client.upload(file, currentId ? { folder_id: currentId } : {});
      } catch (err) {
        if (err instanceof ShelfError && err.code === 'not_configured') return void setNotConfigured(true);
        msgs.push(describe(err, `Could not upload ${file.name}`));
      }
    }
    setAdding((n) => Math.max(0, n - batch.length));
    setNotices(msgs);
    await refresh();
  };

  const guarded = async (fn: () => Promise<void>, action: string) => {
    setWorking(true);
    try {
      await fn();
      setPending(null);
      setError(null);
    } catch (err) {
      fail(err, action);
    } finally {
      setWorking(false);
    }
  };

  const renameItem = (item: ShelfItem, filename: string) =>
    void guarded(async () => {
      const updated = await client!.updateFile(item.id, { filename });
      setSelected((s) => (s && s.id === item.id ? { ...s, ...updated } : s));
      setFiles((fs) => fs.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
    }, 'Could not rename');

  const moveItem = (item: ShelfItem, folderId: string) =>
    void guarded(async () => {
      await client!.updateFile(item.id, { folder_id: folderId });
      setSelected(null);
      setFiles((fs) => fs.filter((x) => x.id !== item.id));
      void loadCensus();
    }, 'Could not move');

  const deleteItem = (item: ShelfItem) =>
    void guarded(async () => {
      await client!.deleteFile(item.id);
      setSelected(null);
      setFiles((fs) => fs.filter((x) => x.id !== item.id));
      void loadCensus();
    }, 'Could not delete');

  // Only what the integration API can do: it renames, moves and deletes documents (read_write keys).
  // It cannot create, rename, move or delete folders, so no menu offers those.
  const itemActions = (item: ShelfItem): MenuAction[] =>
    canWrite
      ? [
          { label: 'Rename', onSelect: () => setPending({ kind: 'rename', item }) },
          { label: 'Move to…', onSelect: () => setPending({ kind: 'move', item }) },
          { label: 'Delete', onSelect: () => setPending({ kind: 'delete', item }), danger: true },
        ]
      : [];

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const dropProps = canWrite
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer?.files?.length) void upload(e.dataTransfer.files);
        },
      }
    : {};

  const rootClass = ['shelf-sdk', className].filter(Boolean).join(' ');
  const themeAttr = theme === 'auto' ? undefined : theme;

  if (!client || notConfigured) {
    return (
      <div className={rootClass} data-theme={themeAttr}>
        <div className={cx('callout', 'notice')} role="alert">
          <strong>Shelf isn&apos;t connected</strong>
          <p>The document store is not set up for this site yet.</p>
        </div>
      </div>
    );
  }

  const isEmpty = ready && !loading && subfolders.length === 0 && files.length === 0 && !error;
  const headerMeta = census
    ? `${plural(census.total, 'item')} · ${plural(folders.length, 'folder')}`
    : folders.length
      ? plural(folders.length, 'folder')
      : '';

  const thumbFor = (f: ShelfItem, preferred: 'small' | 'medium'): string | undefined => {
    const sizes = orderedSizes(f.preview_sizes);
    if (!sizes.length) return undefined;
    return client.thumbnailUrl(f.id, sizes.includes(preferred) ? preferred : sizes[0]);
  };

  const folderCaption = (f: FolderRecord): string | null => {
    const kids = folders.filter((c) => c.parent_id === f.id).length;
    if (totals) return describeContents({ folders: kids, items: totals.get(f.id) ?? 0 });
    return kids > 0 ? plural(kids, 'folder') : null; // document counts unknown: say nothing rather than guess
  };

  const dialog = pending && (
    <ActionDialog
      key={`${pending.kind}:${pending.item.id}`}
      pending={pending}
      folders={folders}
      busy={working}
      onRename={renameItem}
      onMove={moveItem}
      onDelete={deleteItem}
      onCancel={() => setPending(null)}
    />
  );

  const pill = (f: ShelfItem) => {
    const s = statusPill(f.parse_status);
    return s ? <span className={cx('pill', s.tone && `pill--${s.tone}`)}>{s.label}</span> : null;
  };

  const card = (f: ShelfItem) => {
    const type = typeLabel(f.content_type);
    const kind = documentKind(f.content_type);
    const preview = thumbFor(f, 'medium');
    const busy = f.parse_status === 'pending' || f.parse_status === 'parsing';
    const meta = describeMeta(f.parsed_meta as ParsedMeta | null | undefined);
    return (
      <article
        key={f.id}
        className={cx('card', 'file-card', 'shelf-item', selected?.id === f.id && 'is-selected')}
        aria-busy={busy || undefined}
      >
        <div className={cx('file-card-thumb', preview ? `file-card-thumb--${kind}` : `file-card-thumb--doc file-card-thumb--${kind}`)}>
          {preview ? (
            <img src={preview} alt="" width={400} height={300} draggable={false} loading="lazy" decoding="async" />
          ) : (
            <span className={cx('file-card-type')} aria-hidden="true">
              {type}
            </span>
          )}
          {pill(f)}
          {busy && <span className={cx('upload-bar', 'upload-bar--parsing')} aria-hidden="true" />}
        </div>
        <div className={cx('file-card-body')}>
          <p className={cx('card-meta')}>
            {formatSize(f.size_bytes)} · {type}
            {meta && <> · {meta}</>}
          </p>
          <h3 className={cx('file-card-name')}>
            {/* Stretched over the whole card, so a click anywhere opens it. */}
            <button type="button" className={cx('link-btn', 'file-card-link')} onClick={() => void open(f)}>
              {f.filename}
            </button>
          </h3>
        </div>
        <ActionMenu label={f.filename} actions={itemActions(f)} />
      </article>
    );
  };

  const hint = canWrite ? (
    <p className={cx('dropzone-limits', 'shelf-dropzone-hint')}>
      Drop documents here to add them to {currentName} · {UPLOAD_LIMITS}
    </p>
  ) : null;

  const loadMore = cursor && !loading && (
    <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'more')} onClick={() => void loadFiles(currentId, cursor)}>
      Load more
    </button>
  );

  const gallery = (
    <>
      {subfolders.length > 0 && (
        <>
          <h2 className={cx('kicker', 'shelf-section-label')}>Folders</h2>
          <div className={cx('folder-grid')}>
            {subfolders.map((f) => {
              const caption = folderCaption(f);
              return (
                <article key={f.id} className={cx('card', 'folder-tile')} aria-label={`Folder ${f.name}`}>
                  <button type="button" className={cx('link-btn', 'folder-tile-main')} onClick={() => setCurrentId(f.id)}>
                    <FolderIcon />
                    <span className={cx('folder-tile-text')}>
                      <span className={cx('folder-tile-name')}>{f.name}</span>
                      {caption && <span className={cx('card-meta')}>{caption}</span>}
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
      {files.length > 0 && (
        <>
          <div className={cx('shelf-section-head')}>
            <h2 className={cx('kicker', 'shelf-section-label')}>Documents</h2>
          </div>
          <div className={cx('file-grid')} aria-label="Folder contents">
            {files.map((f) => card(f))}
          </div>
        </>
      )}
    </>
  );

  const table = (
    <div className={cx('item-list-scroll')}>
      <table className={cx('item-list')} aria-label="Folder contents">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th className={cx('item-list-num')}>Size</th>
            <th>Added</th>
            <th>
              <span className={cx('visually-hidden')}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {subfolders.map((f) => (
            <tr key={`d-${f.id}`} className={cx('item-row', 'item-row--folder')}>
              <td>
                <button type="button" className={cx('link-btn', 'item-name')} onClick={() => setCurrentId(f.id)}>
                  <span className={cx('item-thumb', 'item-thumb--folder')}>
                    <FolderIcon />
                  </span>
                  <span className={cx('item-name-text')}>{f.name}</span>
                </button>
              </td>
              <td className={cx('item-list-muted')}>{folderCaption(f) ?? ''}</td>
              <td className={cx('item-list-num', 'item-list-muted')}>—</td>
              <td className={cx('item-list-muted')}></td>
              <td className={cx('item-list-actions')} />
            </tr>
          ))}
          {files.map((f) => {
            const preview = thumbFor(f, 'small');
            return (
              <tr key={`f-${f.id}`} className={cx('item-row', selected?.id === f.id && 'is-selected')}>
                <td>
                  <button type="button" className={cx('link-btn', 'item-name')} onClick={() => void open(f)}>
                    {preview ? (
                      <span className={cx('item-thumb')}>
                        <img src={preview} alt="" width={40} height={40} draggable={false} loading="lazy" decoding="async" />
                      </span>
                    ) : (
                      <span className={cx('item-thumb', `item-thumb--${documentKind(f.content_type)}`)}>{typeLabel(f.content_type)}</span>
                    )}
                    <span>
                      <span className={cx('item-name-text')}>{f.filename}</span>
                    </span>
                  </button>
                </td>
                <td>{pill(f)}</td>
                <td className={cx('item-list-num', 'item-list-muted')}>{formatSize(f.size_bytes)}</td>
                <td className={cx('item-list-muted')}>{formatDate(f.created_at)}</td>
                <td className={cx('item-list-actions')}>
                  <ActionMenu label={f.filename} actions={itemActions(f)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={rootClass} data-theme={themeAttr}>
      <div aria-live="polite">
        {notices.map((n) => (
          <p key={n} className={cx('callout', 'callout--danger')} role="alert">
            {n}
          </p>
        ))}
        {error && (
          <p className={cx('callout', 'callout--danger')} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className={cx('shelf-layout', hasFolders ? (treeOpen ? '' : 'shelf-layout--rail') : 'shelf-layout--flat')}>
        {/* The folder tree waits collapsed, as an icon button at the start of the breadcrumb row, until it's asked for. */}
        {hasFolders && (
          <aside className={cx('shelf-sidebar', treeOpen && 'is-open')} aria-label="Folders">
            <button
              type="button"
              className={cx('btn', 'btn--ghost', 'btn--sm', 'shelf-sidebar-toggle')}
              aria-expanded={treeOpen}
              aria-controls="shelf-sdk-folder-tree"
              title={treeOpen ? 'Hide folders' : 'Show folders'}
              onClick={toggleTree}
            >
              <FolderIcon open={treeOpen} />
              <span className={cx('shelf-sidebar-toggle-label')}>{treeOpen ? 'Hide folders' : 'Show folders'}</span>
            </button>
            <div id="shelf-sdk-folder-tree" className={cx('shelf-sidebar-tree')} hidden={!treeOpen}>
              {treeOpen && (
                <FolderTree
                  rootId={rootId}
                  rootName={rootName}
                  folders={folders}
                  files={files}
                  totals={totals}
                  currentFolderId={currentId}
                  currentFileId={selected?.id ?? null}
                  onOpenFolder={setCurrentId}
                  onOpenFile={(f) => void open(f)}
                />
              )}
            </div>
          </aside>
        )}

        <section className={cx('shelf-main')} aria-label={`Contents of ${currentName}`}>
          <div className={cx('shelf-crumbs-row')}>
            <nav className={cx('breadcrumbs')} aria-label="Folder path">
              <ol>
                {crumbs.length === 0 && (
                  <li>
                    <span className={cx('breadcrumb')} aria-current="page">
                      Files
                    </span>
                  </li>
                )}
                {crumbs.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={cx('link-btn', 'breadcrumb')}
                      aria-current={i === crumbs.length - 1 && !selected ? 'page' : undefined}
                      onClick={() => setCurrentId(c.id)}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className={cx('shelf-crumbs-aside')}>{headerMeta && <span className={cx('file-count')}>{headerMeta}</span>}</div>
          </div>

          {dialog}

          {selected ? (
            <DocumentView
              key={selected.id}
              client={client}
              doc={selected}
              location={locationOf(selected)}
              folderName={currentName}
              actions={itemActions(selected)}
              onClose={() => {
                setSelected(null);
                setPending(null);
              }}
            />
          ) : (
            <>
              <div className={cx('shelf-toolbar')}>
                {canWrite && (
                  <>
                    <button type="button" className={cx('btn', 'btn--accent', 'btn--sm')} onClick={() => picker.current?.click()}>
                      Add documents
                    </button>
                    <input
                      ref={picker}
                      type="file"
                      accept={UPLOAD_ACCEPT}
                      multiple
                      hidden
                      aria-label="Upload files"
                      onChange={(e) => {
                        if (e.target.files?.length) void upload(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </>
                )}
                <p className={cx('drag-status')} aria-live="polite">
                  {adding > 0 ? `Adding ${plural(adding, 'document')}…` : ''}
                </p>
                <div className={cx('layout-toggle')} role="group" aria-label="Layout">
                  <button type="button" className={cx('layout-toggle-btn')} aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
                    <GridIcon />
                    Gallery
                  </button>
                  <button type="button" className={cx('layout-toggle-btn')} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
                    <ListIcon />
                    List
                  </button>
                </div>
              </div>

              <div className={cx('shelf-dropzone')} data-drop={over ? 'valid' : undefined} data-testid="shelf-dropzone" {...dropProps}>
                {!ready || (loading && files.length === 0 && subfolders.length === 0) ? (
                  <p className={cx('status-note')} role="status">
                    Loading...
                  </p>
                ) : isEmpty ? (
                  <div className={cx('empty', 'empty--inline')}>
                    <p className={cx('empty-title')}>This folder is empty.</p>
                    {canWrite && <p>Drag documents here to add them.</p>}
                    {canWrite && <p className={cx('dropzone-limits')}>{UPLOAD_LIMITS}</p>}
                  </div>
                ) : (
                  <>
                    {layout === 'list' ? table : gallery}
                    {loadMore}
                    {hint}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
