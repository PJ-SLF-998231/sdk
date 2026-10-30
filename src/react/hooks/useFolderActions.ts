import { useMemo } from 'react';
import type { UseFolderActionsFn } from '../contracts';
import { folderOps } from '../folder/folderOps';
import { useSessionOutbox } from '../provider/useSessionOutbox';
import { useShelfSessionState } from '../useShelfSession';

/** Create, rename, move and delete folders through the outbox (read_write keys); optimistic and offline-safe. Refuses the key's own folder. */
export const useFolderActions: UseFolderActionsFn = (source) => {
  const s = useShelfSessionState(source, true);
  const { outbox, canWrite } = useSessionOutbox(s);
  const root = s.rootFolderId;
  return useMemo(() => ({ canWrite, ...folderOps(outbox, root) }), [outbox, canWrite, root]);
};
