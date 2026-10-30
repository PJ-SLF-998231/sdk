import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { OverlayFolder } from '../../internal/contracts';
import type { OutboxHandle } from '../../outbox';
import type { FolderPending } from '../ActionDialog';
import { ActionMenu } from '../ActionMenu';
import type { MenuAction } from '../ActionMenu';
import { cx } from '../cx';
import { SyncActions } from '../syncUi';
import { FolderNameFormBody } from './FolderNameForm';
import { folderNameError, folderOps, LOCAL_FOLDER_PREFIX } from './folderOps';
import { dialogFallback, FolderDialogPart } from './lazyParts';

interface Args {
  /** The outbox of a read_write key; null for a read key, which gets no folder controls at all. */
  outbox: OutboxHandle | null;
  folders: readonly OverlayFolder[];
  /** The key's own folder: it cannot be renamed, moved or deleted. */
  keyRootId: string | null;
  currentId: string | null;
  onRetry: (outboxId: string) => void;
  onDiscard: (outboxId: string) => void;
  /** Open a folder (used to leave a folder that was just deleted). */
  go: (id: string | null) => void;
}

const message = (err: unknown, what: string) => `${what}: ${err instanceof Error ? err.message : 'something went wrong'}`;

/**
 * The folder controls of a read_write key: the inline New folder form, the "⋯" menu of a card, a row and the current
 * folder (Rename inline, Move to… and Delete in a lazy dialog), all through the outbox. Everything is empty for a read key,
 * for the key's own folder and for a folder that has not reached the server yet.
 */
export function useFolderEditor({ outbox, folders, keyRootId, currentId, onRetry, onDiscard, go }: Args) {
  const ops = useMemo(() => folderOps(outbox, keyRootId), [outbox, keyRootId]);
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pending, setPending] = useState<FolderPending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setAdding(false);
    setRenamingId(null);
    setPending(null);
    setError(null);
  };
  const cancel = () => {
    setAdding(false);
    setRenamingId(null);
    setError(null);
  };
  const editable = (f: OverlayFolder) => !!outbox && !f.localOnly && f.id !== keyRootId && !!f.parent_id && !f.id.startsWith(LOCAL_FOLDER_PREFIX);

  const menu = (f: OverlayFolder): MenuAction[] =>
    editable(f)
      ? [
          {
            label: 'Rename',
            onSelect: () => {
              setRenamingId(f.id);
              setAdding(false);
              setError(null);
            },
          },
          { label: 'Move to…', onSelect: () => setPending({ kind: 'move', folder: f }) },
          { label: 'Delete', onSelect: () => setPending({ kind: 'delete', folder: f }), danger: true },
        ]
      : [];

  const create = (name: string) => {
    const bad = folderNameError(folders, name, currentId);
    if (bad) return setError(bad);
    ops.create(name, currentId).then(
      () => cancel(),
      (err) => setError(message(err, 'Could not create the folder')),
    );
  };
  const rename = (f: OverlayFolder, name: string) => {
    if (name.trim() === f.name) return cancel();
    const bad = folderNameError(folders, name, f.parent_id ?? null, f.id);
    if (bad) return setError(bad);
    ops.rename(f, name).then(
      () => cancel(),
      (err) => setError(message(err, 'Could not rename the folder')),
    );
  };
  const done = (what: string) => ({
    ok: () => {
      setBusy(false);
      setPending(null);
      setError(null);
    },
    fail: (err: unknown) => {
      setBusy(false);
      setError(message(err, what));
    },
  });
  const move = (f: OverlayFolder, parentId: string) => {
    setBusy(true);
    const r = done('Could not move the folder');
    ops.move(f, parentId).then(r.ok, r.fail);
  };
  const remove = (f: OverlayFolder) => {
    setBusy(true);
    const r = done('Could not delete the folder');
    ops.remove(f).then(() => {
      r.ok();
      if (f.id === currentId) go(f.parent_id ?? null);
    }, r.fail);
  };

  const form = (label: string, initialName: string, submit: string, onSubmit: (name: string) => void) => (
    <FolderNameFormBody label={label} initialName={initialName} submitLabel={submit} error={error} onSubmit={onSubmit} onCancel={cancel} onEdit={() => setError(null)} />
  );
  const card = (f: OverlayFolder) => ({
    actions: menu(f),
    sync: f.sync,
    renaming: renamingId === f.id ? { error, onSubmit: (name: string) => rename(f, name), onCancel: cancel, onEdit: () => setError(null) } : null,
    meta: outbox ? <SyncActions item={f as never} onRetry={onRetry} onDiscard={onDiscard} /> : null,
  });
  const current = folders.find((f) => f.id === currentId);

  return {
    adding,
    /** Reset everything: used when the folder shown changes. */
    reset,
    startAdding: () => {
      setAdding(true);
      setRenamingId(null);
      setError(null);
    },
    /** The inline form of a new folder, as a grid tile or a list row. */
    newFolder: (list: boolean): ReactNode =>
      adding && <div className={cx('card', 'folder-tile', 'folder-tile--new', list && 'list-new-folder')}>{form('New folder name', '', 'Create', create)}</div>,
    /** Extra props of a folder card (or row): the menu, the rename form, the sync state and Retry / Keep mine / Discard. */
    cardProps: card,
    /** The same for a list row: the rename form replaces the name. */
    rowProps: (f: OverlayFolder) => {
      const { actions, sync, meta, renaming } = card(f);
      return { actions, sync, meta, rename: renaming ? form(`Rename ${f.name}`, f.name, 'Save', (name) => rename(f, name)) : null };
    },
    /** The "⋯" menu of the folder shown (Rename, Move to…, Delete), for the header. */
    headerMenu: current && editable(current) ? <ActionMenu label={`folder ${current.name}`} actions={menu(current)} /> : null,
    /** The rename form of the folder shown, and the Move to… / Delete dialog. */
    panel: (
      <>
        {current && renamingId === current.id && <div className={cx('callout')}>{form(`Rename ${current.name}`, current.name, 'Save', (name) => rename(current, name))}</div>}
        {pending && (
          <FolderDialogPart.Part
            key={`${pending.kind}:${pending.folder.id}`}
            fallback={dialogFallback}
            pending={pending}
            folders={folders}
            busy={busy}
            error={error}
            onMove={move}
            onDelete={remove}
            onCancel={() => {
              setPending(null);
              setError(null);
            }}
          />
        )}
      </>
    ),
  };
}
