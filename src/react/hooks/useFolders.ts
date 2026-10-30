import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useResource } from '../../hooks/useResource';
import type { OverlayFolder } from '../../internal/contracts';
import type { ShelfFolder } from '../../types';
import type { UseFoldersFn, UseFoldersResult } from '../contracts';
import { buildFolderModel, totalsFromFolders } from '../folderModel';
import type { Census } from '../folderModel';
import { mergeSame } from '../provider/merge';
import { useSessionOutbox } from '../provider/useSessionOutbox';
import { useShelfSessionState } from '../useShelfSession';
import type { ShelfSessionState } from '../useShelfSession';

const NONE: ShelfFolder[] = [];

/**
 * Every folder the key can see, with queued folder operations applied, plus the tree helpers (children, path,
 * document totals). One GET /folders per session however many consumers share it.
 */
export const useFolders: UseFoldersFn = (source) => useFoldersOf(useShelfSessionState(source, true)).folders;

/** useFolders on an open session state, plus the session's outbox (useFolder shares both rather than opening them twice). */
export function useFoldersOf(s: ShelfSessionState) {
  const { swr, client, session } = s;
  const res = useResource<ShelfFolder[]>(
    swr,
    useMemo(
      () =>
        swr && client
          ? {
              key: 'folders',
              merge: mergeSame,
              fetcher: async (signal: AbortSignal) => {
                const all = await client.folders({ signal });
                return Array.isArray(all) ? all : [];
              },
            }
          : null,
      [swr, client],
    ),
  );
  const server = res.data ?? NONE;
  const { outbox, entries } = useSessionOutbox(s);

  // Queued folder operations (a folder created offline, renamed, moved or deleted) show at once. Until the lazy outbox chunk
  // has arrived (it brings applyFolderOutbox and isFolderOp) the server's folders show as they are.
  const apply = outbox ? session?.applyFolderOutbox : null;
  const folders = useMemo<OverlayFolder[]>(() => (apply ? apply(server, entries) : server.map((f) => ({ ...f, sync: 'synced' as const }))), [apply, server, entries]);

  // Document counts. /folders sends them when the API is new enough; else count by listing everything (capped).
  const needCensus = res.data !== undefined && totalsFromFolders(res.data) === null;
  const [census, setCensus] = useState<Census | null>(null);
  const [tick, bumpCensus] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!needCensus || !client) {
      setCensus(null);
      return;
    }
    let live = true;
    // The fallback is rare (an API that sends counts needs none), so its code is a lazy chunk.
    void import('../provider/census').then((m) => m.loadCensus(client, server, () => live)).then((c) => {
      if (live) setCensus(c);
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [client, needCensus, tick, server]);

  // The root is decided from the server's folders, so a queued change cannot move it.
  const model = useMemo(() => buildFolderModel(folders, server, census), [folders, server, census]);
  const refresh = useCallback(async () => {
    bumpCensus();
    await res.refresh();
  }, [res.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = res.data === undefined && res.error === undefined && !s.lost && !!client;
  const result: UseFoldersResult = {
    folders,
    byId: model.byId,
    rootId: model.rootId,
    childrenOf: model.childrenOf,
    pathTo: model.pathTo,
    totals: model.totals,
    totalItems: model.totalItems,
    loading,
    error: res.error,
    offline: res.offline,
    stale: res.stale,
    refresh,
  };
  return { folders: result, outbox, entries, session, loaded: res.data !== undefined };
}
