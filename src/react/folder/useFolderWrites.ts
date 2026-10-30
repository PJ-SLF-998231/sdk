import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { isAuthLost, ShelfError } from '../../client';
import type { OutboxOp } from '../../internal/contracts';
import type { OutboxHandle } from '../../outbox';
import type { ShelfItem } from '../../types';
import type { Pending } from '../ActionDialog';
import type { Session } from '../session';

export const NO_EDITS = { patched: {} as Record<string, Partial<ShelfItem>>, removed: [] as string[] };
const NO_LANDED: ShelfItem[] = [];

/** The message for a failed load or write. */
export function describe(err: unknown, action: string): string {
  if (err instanceof ShelfError) {
    if (err.status === 413) return `${action}: the file is too large.`;
    if (err.status === 415) return `${action}: this file type is not supported.`;
    return `${action}: ${err.message}`;
  }
  return `${action}: ${err instanceof Error ? err.message : 'something went wrong'}`;
}

interface Args {
  session: Session;
  outbox: OutboxHandle | null;
  currentId: string | null;
  currentRef: MutableRefObject<string | null>;
  selectedId: string | null;
  closeDocument: () => void;
  setPending: (p: Pending | null) => void;
  /** A queued change reached the server: refresh what shows the server's state. */
  onApplied: () => void;
}

/**
 * Document writes through the outbox (upload, rename, move, delete) and what shows until the refreshed listing has caught
 * up: `edits` (renamed and removed documents) and `landed` (uploads the server has accepted).
 */
export function useFolderWrites({ session, outbox, currentId, currentRef, selectedId, closeDocument, setPending, onApplied }: Args) {
  const [edits, setEdits] = useState(NO_EDITS);
  const [landed, setLanded] = useState<ShelfItem[]>(NO_LANDED);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const applied = useRef(onApplied);
  applied.current = onApplied;

  const reset = useCallback(() => {
    setEdits(NO_EDITS);
    setLanded(NO_LANDED);
  }, []);

  // A queued change reached the server: show the server's answer until the refreshed listing arrives.
  useEffect(() => {
    if (!outbox) return;
    return outbox.on('applied', ({ entry, item }) => {
      const op = entry.op;
      if (op.kind === 'upload') {
        if (item) setLanded((l) => [item as ShelfItem, ...l.filter((x) => x.id !== item.id)]);
      } else if (op.kind === 'rename') {
        if (item) setEdits((e) => ({ ...e, patched: { ...e.patched, [op.fileId]: { ...(e.patched[op.fileId] ?? {}), ...(item as ShelfItem) } } }));
      } else if (op.kind === 'delete' || (op.kind === 'move' && op.folderId !== currentRef.current)) {
        setEdits((e) => ({ ...e, removed: [...e.removed, op.fileId] }));
      }
      applied.current();
    });
  }, [outbox, currentRef]);

  const fail = useCallback(
    (err: unknown, action: string) => {
      if (err instanceof ShelfError && err.code === 'not_configured') session.loseAuth(err);
      else if (!isAuthLost(err)) setActionError(describe(err, action));
    },
    [session],
  );

  const enqueue = async (op: OutboxOp, action: string) => {
    if (!outbox) return;
    setWorking(true);
    try {
      await outbox.enqueue(op);
      setPending(null);
      setActionError(null);
    } catch (err) {
      fail(err, action);
    } finally {
      setWorking(false);
    }
  };

  const upload = async (list: FileList | File[]) => {
    if (!outbox) return;
    for (const file of Array.from(list)) {
      try {
        await outbox.enqueue({
          kind: 'upload',
          folderId: currentId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          bytes: await file.arrayBuffer(),
          clientRef: '', // the outbox mints the UUID that makes a retried upload idempotent
        });
      } catch (err) {
        fail(err, `Could not upload ${file.name}`);
      }
    }
  };

  const leaveDocument = () => {
    if (selectedId) closeDocument();
  };
  const renameItem = (item: ShelfItem, filename: string) => void enqueue({ kind: 'rename', fileId: item.id, filename, baseFilename: item.filename }, 'Could not rename');
  const moveItem = (item: ShelfItem, folderId: string) => {
    leaveDocument();
    void enqueue({ kind: 'move', fileId: item.id, folderId, baseFolderId: item.folder_id ?? null }, 'Could not move');
  };
  const deleteItem = (item: ShelfItem) => {
    leaveDocument();
    void enqueue({ kind: 'delete', fileId: item.id }, 'Could not delete');
  };
  const onRetry = useCallback(
    (id: string) => {
      const entry = outbox?.list().find((e) => e.id === id);
      void outbox?.retry(id, entry?.status === 'conflict' ? { force: true } : undefined);
    },
    [outbox],
  );
  const onDiscard = useCallback((id: string) => void outbox?.discard(id), [outbox]);

  return { edits, landed, reset, actionError, setActionError, working, upload, renameItem, moveItem, deleteItem, onRetry, onDiscard };
}
