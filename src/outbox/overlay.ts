import type { ApplyOutboxFn, ItemSyncState, OutboxEntry, OverlayItem } from '../internal/contracts';
import type { ShelfItem } from '../types';

/** The document id an entry is about; an upload is addressed as `local:<clientRef>` until it has a server id. */
export function fileKeyOf(entry: Pick<OutboxEntry, 'op'>): string {
  const op = entry.op;
  return op.kind === 'upload' ? 'local:' + op.clientRef : op.fileId;
}

function syncOf(entry: OutboxEntry): ItemSyncState {
  return entry.status === 'failed' ? 'failed' : entry.status === 'conflict' ? 'conflict' : 'pending';
}

// Touched items are memoised so a re-render with an unchanged outbox hands React the same objects.
const touched = new WeakMap<object, Map<string, OverlayItem>>();
const localItems = new WeakMap<OutboxEntry, OverlayItem>();

function memo(base: object, sig: string, make: () => OverlayItem): OverlayItem {
  let per = touched.get(base);
  if (!per) touched.set(base, (per = new Map()));
  let hit = per.get(sig);
  if (!hit) {
    if (per.size > 8) per.clear();
    per.set(sig, (hit = make()));
  }
  return hit;
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
    let sync: ItemSyncState | undefined;
    let outboxId: string | undefined;
    let syncError: string | undefined;
    for (const e of list) {
      const state = syncOf(e);
      // The most urgent state wins: conflict > failed > pending.
      if (!sync || state === 'conflict' || (state === 'failed' && sync === 'pending')) {
        sync = state;
        outboxId = e.id;
        syncError = e.error?.message;
      }
      if (e.status === 'conflict') continue;
      const op = e.op;
      if (op.kind === 'rename') filename = op.filename;
      else if (op.kind === 'move') folder = op.folderId;
      else if (op.kind === 'delete' && e.status !== 'failed') hidden = true;
    }
    if (hidden) continue;
    if (folder !== item.folder_id && folder !== folderId) continue; // moved out of this listing
    const sig = [filename, folder, sync, outboxId, syncError].join('\u0000');
    const entryItem: ShelfItem = item;
    out.push(
      memo(entryItem, sig, () => ({
        ...entryItem,
        filename,
        folder_id: folder,
        sync: sync ?? 'pending',
        ...(outboxId ? { outboxId } : {}),
        ...(syncError ? { syncError } : {}),
      })),
    );
  }
  return out;
};
