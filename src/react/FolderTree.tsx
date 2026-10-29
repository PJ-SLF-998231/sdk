import { useMemo, useState } from 'react';
import type { ShelfFolder as FolderRecord, ShelfItem } from '../types';
import { ChevronIcon, FileIcon, FolderIcon } from './icons';
import { cx } from './cx';
import { documentKind, statusPill } from './format';

export const TREE_FILES_SHOWN = 10;

export interface FolderTreeProps {
  rootId: string | null;
  rootName: string;
  folders: FolderRecord[];
  /** The documents loaded for the open folder; each is listed under it. */
  files: readonly ShelfItem[];
  /** Documents at any depth under each folder, when known (the tree shows no count otherwise). */
  totals: ReadonlyMap<string, number> | null;
  currentFolderId: string | null;
  currentFileId: string | null;
  onOpenFolder: (id: string) => void;
  onOpenFile: (file: ShelfItem) => void;
}

/**
 * Sidebar tree of the folders, like a file explorer (ported from Shelf web's FolderTree):
 * subfolders first, each with how many documents it holds, then the open folder's documents.
 * The folders above the open one always stay expanded so you can see where you are.
 */
export function FolderTree({ rootId, rootName, folders, files, totals, currentFolderId, currentFileId, onOpenFolder, onOpenFile }: FolderTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showingAll, setShowingAll] = useState(false);
  const known = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const childrenOf = (parent: string | null) =>
    folders
      .filter((f) => (parent === null ? !f.parent_id || !known.has(f.parent_id) : f.parent_id === parent))
      .sort((a, b) => a.name.localeCompare(b.name));

  const ancestors = useMemo(() => {
    const out = new Set<string>();
    const byId = new Map(folders.map((f) => [f.id, f]));
    let id = currentFolderId;
    while (id) {
      out.add(id);
      id = byId.get(id)?.parent_id ?? null;
    }
    if (currentFileId === null && currentFolderId) out.delete(currentFolderId);
    return out;
  }, [folders, currentFolderId, currentFileId]);

  const folderIsCurrent = (id: string | null) => currentFileId === null && id === currentFolderId;
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderFile = (file: ShelfItem) => {
    const status = statusPill(file.parse_status);
    const busy = file.parse_status === 'pending' || file.parse_status === 'parsing';
    return (
      <li key={file.id} className={cx('folder-tree-file')}>
        <div className={cx('folder-tree-row')}>
          <span className={cx('folder-tree-toggle')} aria-hidden="true" />
          <button
            type="button"
            className={cx('link-btn', 'folder-tree-link', 'folder-tree-link--file')}
            title={file.filename}
            aria-current={file.id === currentFileId ? 'page' : undefined}
            aria-busy={busy || undefined}
            onClick={() => onOpenFile(file)}
          >
            <FileIcon kind={documentKind(file.content_type)} />
            <span className={cx('folder-tree-name')}>{file.filename}</span>
            {busy && status && <span className={cx('folder-tree-status')}>{status.label}</span>}
          </button>
        </div>
      </li>
    );
  };

  const renderLevel = (parentId: string | null) => {
    const children = childrenOf(parentId);
    const levelFiles = files.filter((f) => (f.folder_id ?? null) === parentId);
    const shown = showingAll ? levelFiles : levelFiles.slice(0, TREE_FILES_SHOWN);
    if (children.length === 0 && levelFiles.length === 0) return null;
    return (
      <ul className={cx('folder-tree-list')}>
        {children.map((folder) => {
          const hasContents = folders.some((f) => f.parent_id === folder.id) || files.some((f) => f.folder_id === folder.id);
          const total = totals?.get(folder.id) ?? 0;
          const isLocked = ancestors.has(folder.id);
          const isExpanded = hasContents && (isLocked || !collapsed.has(folder.id));
          return (
            <li key={folder.id}>
              <div className={cx('folder-tree-row')}>
                {hasContents ? (
                  <button
                    type="button"
                    className={cx('folder-tree-toggle')}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${folder.name}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggle(folder.id)}
                    disabled={isLocked}
                  >
                    <ChevronIcon />
                  </button>
                ) : (
                  <span className={cx('folder-tree-toggle')} aria-hidden="true" />
                )}
                <button
                  type="button"
                  className={cx('link-btn', 'folder-tree-link')}
                  title={folder.name}
                  aria-current={folderIsCurrent(folder.id) ? 'page' : undefined}
                  onClick={() => onOpenFolder(folder.id)}
                >
                  <FolderIcon open={folder.id === currentFolderId} />
                  <span className={cx('folder-tree-name')}>{folder.name}</span>
                  {total > 0 && (
                    <span className={cx('folder-tree-count')} title={`${total} ${total === 1 ? 'document' : 'documents'}, subfolders included`} aria-hidden="true">
                      {total}
                    </span>
                  )}
                </button>
              </div>
              {isExpanded && renderLevel(folder.id)}
            </li>
          );
        })}
        {shown.map(renderFile)}
        {levelFiles.length > TREE_FILES_SHOWN && (
          <li className={cx('folder-tree-more')}>
            <button type="button" className={cx('link-btn', 'folder-tree-more-button')} onClick={() => setShowingAll((v) => !v)}>
              {showingAll ? 'Show fewer' : `Show ${levelFiles.length - shown.length} more`}
            </button>
          </li>
        )}
      </ul>
    );
  };

  return (
    <nav className={cx('folder-tree')} aria-label={`Folders in ${rootName}`}>
      <div className={cx('folder-tree-row', 'folder-tree-row--root')}>
        <button
          type="button"
          className={cx('link-btn', 'folder-tree-link')}
          aria-current={folderIsCurrent(rootId) ? 'page' : undefined}
          onClick={() => rootId && onOpenFolder(rootId)}
        >
          <span className={cx('folder-tree-name')}>{rootName}</span>
        </button>
      </div>
      <div className={cx('folder-tree-scroll')}>
        {renderLevel(rootId === null ? null : rootId)}
        {folders.length === 0 && <p className={cx('folder-tree-empty')}>No folders yet.</p>}
      </div>
    </nav>
  );
}
