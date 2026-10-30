import { useMemo } from 'react';
import type { OutboxOp } from '../../internal/contracts';
import type { UseDocumentActionsFn } from '../contracts';
import { useSessionOutbox } from '../provider/useSessionOutbox';
import { useShelfSessionState } from '../useShelfSession';

/** Rename, move and delete a document through the outbox (read_write keys); optimistic and offline-safe. */
export const useDocumentActions: UseDocumentActionsFn = (source) => {
  const s = useShelfSessionState(source, true);
  const { outbox, canWrite } = useSessionOutbox(s);
  return useMemo(() => {
    const enqueue = async (op: OutboxOp): Promise<void> => {
      if (!outbox) throw new Error('Shelf: this key cannot change documents');
      await outbox.enqueue(op);
    };
    return {
      canWrite,
      rename: (item, filename) => enqueue({ kind: 'rename', fileId: item.id, filename, baseFilename: item.filename }),
      move: (item, folderId) => enqueue({ kind: 'move', fileId: item.id, folderId, baseFolderId: item.folder_id ?? null }),
      remove: (item) => enqueue({ kind: 'delete', fileId: item.id }),
    };
  }, [outbox, canWrite]);
};
