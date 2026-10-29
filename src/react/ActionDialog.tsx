import { useState } from 'react';
import type { ShelfFolder as FolderRecord, ShelfItem } from '../types';
import { cx } from './cx';

export type Pending = { kind: 'rename' | 'move' | 'delete'; item: ShelfItem };

interface Props {
  pending: Pending;
  folders: FolderRecord[];
  busy: boolean;
  onRename: (item: ShelfItem, filename: string) => void;
  onMove: (item: ShelfItem, folderId: string) => void;
  onDelete: (item: ShelfItem) => void;
  onCancel: () => void;
}

/** Inline form for the three document actions the integration API supports: rename, move, delete (to the Shelf trash). */
export function ActionDialog({ pending, folders, busy, onRename, onMove, onDelete, onCancel }: Props) {
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
