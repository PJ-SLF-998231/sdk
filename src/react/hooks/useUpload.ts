import { useCallback, useMemo } from 'react';
import type { UseUploadFn } from '../contracts';
import { useSessionOutbox } from '../provider/useSessionOutbox';
import { useShelfSessionState } from '../useShelfSession';

/** Local folders (created offline, not yet on the server) cannot take uploads until they sync. */
const isLocalFolder = (id: string | null): boolean => !!id && id.startsWith('local-folder:');

/** Queues uploads into a folder (`null` = the key's root) through the outbox: they survive going offline and reloads. */
export const useUpload: UseUploadFn = (folderId, source) => {
  const s = useShelfSessionState(source, true);
  const { outbox, entries } = useSessionOutbox(s);
  const canUpload = !!outbox && !isLocalFolder(folderId);
  const upload = useCallback(
    async (files: readonly File[]) => {
      if (!outbox || isLocalFolder(folderId)) return;
      for (const file of Array.from(files)) {
        await outbox.enqueue({
          kind: 'upload',
          folderId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          bytes: await file.arrayBuffer(),
          clientRef: '', // the outbox mints the UUID that makes a retried upload idempotent
        });
      }
    },
    [outbox, folderId],
  );
  const adding = useMemo(() => entries.some((e) => e.op.kind === 'upload' && (e.status === 'pending' || e.status === 'running')), [entries]);
  return { canUpload, upload, adding };
};
