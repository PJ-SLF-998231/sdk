import type {
  ApplyFolderOutboxFn,
  ApplyOutboxFn,
  FolderOutboxEntry,
  FolderOutboxOp,
  ItemSyncState,
  OutboxEntry,
  OutboxOp,
  OverlayFolder,
  OverlayItem,
} from '../internal/contracts';
import type { ShelfFolder, ShelfItem } from '../types';

/** Id prefix of a folder that only exists in the outbox (a queued createFolder). */
export const LOCAL_FOLDER = 'local-folder:';

export const isFolderOp = (op: OutboxOp): op is FolderOutboxOp => op.kind.endsWith('Folder');

/**
 * The document or folder id an entry is about; an upload is addressed as `local:<clientRef>` and a createFolder as
 * `local-folder:<clientRef>` until they have a server id.
 */
export function fileKeyOf(entry: Pick<OutboxEntry, 'op'>): string {
  const op = entry.op;
  return op.kind === 'upload' ? 'local:' + op.clientRef : op.kind === 'createFolder' ? LOCAL_FOLDER + op.clientRef : 'folderId' in op && isFolderOp(op) ? op.folderId : (op as { fileId: string }).fileId;
}

function syncOf(entry: OutboxEntry): ItemSyncState {
  return entry.status === 'failed' ? 'failed' : entry.status === 'conflict' ? 'conflict' : 'pending';
}

// Touched items are memoised so a re-render with an unchanged outbox hands React the same objects.
const touched = new WeakMap<object, Map<string, object>>();
const localItems = new WeakMap<OutboxEntry, OverlayItem>();

function memo<T extends object>(base: object, sig: string, make: () => T): T {
  let per = touched.get(base);
  if (!per) touched.set(base, (per = new Map()));
  let hit = per.get(sig);
  if (!hit) {
    if (per.size > 8) per.clear();
    per.set(sig, (hit = make()));
  }
  return hit as T;
}

/** The most urgent state of a document's or folder's entries wins: conflict > failed > pending. */
function urgent(list: readonly OutboxEntry[]): { sync: ItemSyncState; outboxId: string; syncError?: string } {
  let best = list[0]!;
  for (const e of list) if (e.status === 'conflict' || (e.status === 'failed' && syncOf(best) === 'pending')) best = e;
  return { sync: syncOf(best), outboxId: best.id, ...(best.error ? { syncError: best.error.message } : {}) };
}

/**
 * Items as the user should see them. Items no entry touches are returned as the very same object
 * (no `sync` property: absent means 'synced'); touched ones are new overlay objects. Queued uploads for
 * `folderId` come first as `local:<clientRef>` items with `localOnly`.
 * Pending/running/failed renames, moves and deletes are shown as if applied (a failed delete stays
 * visible so it can be retried); a conflicting change is not applied, the server version is shown.
 */
export const applyOutbox: ApplyOutboxFn = (items, entries, folderId) => {
  const byFile = new Map<string, OutboxEntry[]>();
  const uploads: OutboxEntry[] = [];
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  for (const e of ordered) {
    if (e.op.kind === 'upload') {
      if (e.op.folderId === folderId) uploads.push(e);
      continue;
    }
    if (isFolderOp(e.op)) continue;
    const k = e.op.fileId;
    const list = byFile.get(k);
    if (list) list.push(e);
    else byFile.set(k, [e]);
  }

  const out: OverlayItem[] = [];
  for (const e of uploads) {
    const op = e.op;
    if (op.kind !== 'upload') continue;
    let local = localItems.get(e);
    if (!local) {
      local = {
        id: 'local:' + op.clientRef,
        filename: op.filename,
        content_type: op.contentType,
        size_bytes: op.size,
        folder_id: op.folderId,
        parse_status: 'pending',
        created_at: new Date(e.createdAt).toISOString(),
        edited_at: null,
        parsed_at: null,
        preview_sizes: [],
        sync: syncOf(e),
        outboxId: e.id,
        localOnly: true,
        ...(e.error ? { syncError: e.error.message } : {}),
      };
      localItems.set(e, local);
    }
    out.push(local);
  }

  for (const item of items) {
    const list = byFile.get(item.id);
    if (!list) {
      out.push(item as OverlayItem);
      continue;
    }
    let filename = item.filename;
    let folder = item.folder_id;
    let hidden = false;
    for (const { op, status } of list) {
      if (status === 'conflict') continue;
      if (op.kind === 'rename') filename = op.filename;
      else if (op.kind === 'move') folder = op.folderId;
      else if (op.kind === 'delete' && status !== 'failed') hidden = true;
    }
    if (hidden) continue;
    if (folder !== item.folder_id && folder !== folderId) continue; // moved out of this listing
    const u = urgent(list);
    out.push(memo<OverlayItem>(item, [filename, folder, u.sync, u.outboxId, u.syncError].join('\0'), () => ({ ...item, filename, folder_id: folder, ...u })));
  }
  return out;
};

const localFolders = new WeakMap<OutboxEntry, OverlayFolder>();

/**
 * Folders as the user should see them. Folders no entry touches are returned as the very same object; touched ones are
 * new overlay objects. Queued createFolders are appended as `local-folder:<clientRef>` folders with `localOnly`
 * (their parent is the key's folder when `parentId` is null). Renames and moves are shown as applied, a deleted folder
 * and everything below it is hidden (a failed delete stays visible so it can be retried), a conflicting change is not applied.
 */
export const applyFolderOutbox: ApplyFolderOutboxFn = (folders, entries) => {
  const byFolder = new Map<string, FolderOutboxEntry[]>();
  const creates: FolderOutboxEntry[] = [];
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.op.kind === 'createFolder') creates.push(e);
    else byFolder.set(e.op.folderId, [...(byFolder.get(e.op.folderId) ?? []), e]);
  }

  const hidden = new Set<string>();
  const live: Array<ShelfFolder | OverlayFolder> = [];
  for (const f of folders) {
    const list = byFolder.get(f.id);
    if (!list) {
      live.push(f);
      continue;
    }
    let { name, parent_id: parent } = f;
    for (const { op, status } of list) {
      if (status === 'conflict') continue;
      if (op.kind === 'renameFolder') name = op.name;
      else if (op.kind === 'moveFolder') parent = op.parentId;
      else if (op.kind === 'deleteFolder' && status !== 'failed') hidden.add(f.id);
    }
    const u = urgent(list);
    live.push(memo(f, [name, parent, u.sync, u.outboxId, u.syncError].join('\0'), () => ({ ...f, name, parent_id: parent, ...u })));
  }

  // A deleted folder takes everything below it along.
  for (let grew = hidden.size > 0; grew; ) {
    grew = false;
    for (const f of folders) if (f.parent_id && hidden.has(f.parent_id) && !hidden.has(f.id)) grew = !!hidden.add(f.id);
  }
  const out = live.filter((f) => !hidden.has(f.id)) as OverlayFolder[];

  const root = folders.find((f) => f.parent_id == null)?.id ?? null;
  for (const e of creates) {
    const op = e.op;
    if (op.kind !== 'createFolder') continue;
    const parent = op.parentId ?? root;
    let hit = localFolders.get(e);
    if (!hit || hit.parent_id !== parent) {
      hit = { id: LOCAL_FOLDER + op.clientRef, name: op.name, parent_id: parent, item_count: 0, total_item_count: 0, localOnly: true, ...urgent([e]) };
      localFolders.set(e, hit);
    }
    if (!parent || !hidden.has(parent)) out.push(hit);
  }
  return out;
};
