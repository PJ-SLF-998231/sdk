import type { OutboxOp } from '../../internal/contracts';
import type { OutboxHandle } from '../../outbox';
import type { ShelfFolderRecord, UseFolderActionsResult } from '../contracts';

/** Folders made offline carry this id prefix until the server has them (the same constant as the outbox's, which stays a lazy chunk). */
export const LOCAL_FOLDER_PREFIX = 'local-folder:';

/** The API allows 60 characters; the same wording as Shelf web. */
const MAX_NAME = 60;

/** Why `name` cannot be used for a folder directly inside `parentId` (`excludeId` is the folder being renamed), else null. */
export function folderNameError(folders: readonly ShelfFolderRecord[], name: string, parentId: string | null, excludeId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the folder a name.';
  if (n.length > MAX_NAME) return `Keep folder names to ${MAX_NAME} characters or fewer.`;
  const clash = folders.some((f) => (f.parent_id ?? null) === parentId && f.id !== excludeId && f.name.localeCompare(n, undefined, { sensitivity: 'base' }) === 0);
  return clash ? `A folder named “${n}” is already there.` : null;
}

/**
 * Folder writes through the outbox: optimistic and offline-safe. The key's own folder (`rootId`, or any folder without a
 * parent) is refused, as the API does with a 403.
 */
export function folderOps(outbox: OutboxHandle | null, rootId: string | null): Omit<UseFolderActionsResult, 'canWrite'> {
  const put = async (op: OutboxOp, folder?: ShelfFolderRecord): Promise<void> => {
    if (!outbox) throw new Error('Shelf: this key cannot change folders');
    if (folder && (folder.id === rootId || !folder.parent_id)) throw new Error("Shelf: the key's own folder cannot be changed");
    await outbox.enqueue(op);
  };
  return {
    create: (name, parentId) => put({ kind: 'createFolder', name: name.trim(), parentId, clientRef: '' }), // the outbox mints the clientRef
    rename: (f, name) => put({ kind: 'renameFolder', folderId: f.id, name: name.trim(), baseName: f.name }, f),
    move: (f, parentId) => put({ kind: 'moveFolder', folderId: f.id, parentId, baseParentId: f.parent_id ?? null }, f),
    remove: (f) => put({ kind: 'deleteFolder', folderId: f.id }, f),
  };
}
