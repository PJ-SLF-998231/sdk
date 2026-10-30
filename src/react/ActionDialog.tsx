import { useState } from 'react';
import type { OverlayFolder } from '../internal/contracts';
import type { ShelfFolder as FolderRecord, ShelfItem } from '../types';
import { cx } from './cx';

export type Pending = { kind: 'rename' | 'move' | 'delete'; item: ShelfItem };

export interface ActionDialogProps {
  pending: Pending;
  folders: FolderRecord[];
  busy: boolean;
  onRename: (item: ShelfItem, filename: string) => void;
  onMove: (item: ShelfItem, folderId: string) => void;
  onDelete: (item: ShelfItem) => void;
  onCancel: () => void;
}

/** Inline form for the three document actions the integration API supports: rename, move, delete (to the Shelf trash). */
export function ActionDialog({ pending, folders, busy, onRename, onMove, onDelete, onCancel }: ActionDialogProps) {
  const { item } = pending;
  const [name, setName] = useState(item.filename);
  const targets = folders.filter((f) => f.id !== item.folder_id);
  const [target, setTarget] = useState(targets[0]?.id ?? '');

  if (pending.kind === 'rename') {
    return (
      <form
        className={cx('callout', 'studio-actions')}
        aria-label="Rename document"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onRename(item, name.trim());
        }}
      >
        <label>
          <span className={cx('visually-hidden')}>New name</span>
          <input type="text" className={cx('text-input')} value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" data-autofocus />
        </label>
        <button type="submit" className={cx('btn', 'btn--accent', 'btn--sm')} disabled={busy || !name.trim()}>
          Save name
        </button>
        <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onCancel}>
          Cancel
        </button>
      </form>
    );
  }
  if (pending.kind === 'move') {
    return (
      <form
        className={cx('callout', 'studio-actions')}
        aria-label="Move document"
        onSubmit={(e) => {
          e.preventDefault();
          if (target) onMove(item, target);
        }}
      >
        <label>
          <span className={cx('visually-hidden')}>Destination folder</span>
          <select className={cx('text-input')} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Destination folder">
            {targets.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={cx('btn', 'btn--accent', 'btn--sm')} disabled={busy || !target}>
          Move here
        </button>
        <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onCancel}>
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className={cx('callout', 'callout--danger', 'studio-actions')} role="alertdialog" aria-label="Confirm delete">
      <span>Move {item.filename} to the Shelf trash? You can restore it in Shelf.</span>
      <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'btn--danger')} disabled={busy} onClick={() => onDelete(item)}>
        Confirm delete
      </button>
      <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export type FolderPending = { kind: 'move' | 'delete'; folder: OverlayFolder };

export interface FolderDialogProps {
  pending: FolderPending;
  folders: readonly OverlayFolder[];
  busy: boolean;
  error: string | null;
  onMove: (folder: OverlayFolder, parentId: string) => void;
  onDelete: (folder: OverlayFolder) => void;
  onCancel: () => void;
}

/** Inline form for "Move to…" and the delete confirmation of a folder (the lazy sibling of ActionDialog). */
export function FolderDialog({ pending, folders, busy, error, onMove, onDelete, onCancel }: FolderDialogProps) {
  const { folder } = pending;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (f: OverlayFolder): string => {
    const names: string[] = [];
    for (let at: OverlayFolder | undefined = f; at && names.length < 64; at = at.parent_id ? byId.get(at.parent_id) : undefined) names.unshift(at.name);
    return names.join(' / ');
  };
  // Not itself, nothing below it (a cycle), nothing that is not on the server yet, and not where it already is.
  const below = new Set([folder.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) if (f.parent_id && below.has(f.parent_id) && !below.has(f.id)) grew = !!below.add(f.id);
  }
  const targets = folders.filter((f) => !below.has(f.id) && !f.localOnly && f.id !== folder.parent_id);
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const problem = error && (
    <p className={cx('field-error')} role="alert">
      {error}
    </p>
  );
  if (pending.kind === 'move') {
    return (
      <form
        className={cx('callout', 'studio-actions')}
        aria-label="Move folder"
        onSubmit={(e) => {
          e.preventDefault();
          if (target) onMove(folder, target);
        }}
      >
        <label>
          <span className={cx('visually-hidden')}>Destination folder</span>
          <select className={cx('text-input')} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Destination folder">
            {targets.map((f) => (
              <option key={f.id} value={f.id}>
                {pathOf(f)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={cx('btn', 'btn--accent', 'btn--sm')} disabled={busy || !target}>
          Move here
        </button>
        <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onCancel}>
          Cancel
        </button>
        {problem}
      </form>
    );
  }
  return (
    <div className={cx('callout', 'callout--danger', 'studio-actions')} role="alertdialog" aria-label="Confirm delete folder">
      <span>Move “{folder.name}” and everything in it to the Shelf trash? You can restore it in Shelf.</span>
      <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'btn--danger')} disabled={busy} onClick={() => onDelete(folder)}>
        Confirm delete
      </button>
      <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onCancel}>
        Cancel
      </button>
      {problem}
    </div>
  );
}
