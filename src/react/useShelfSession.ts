import { useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { SwrImpl } from '../cache/swr';
import type { ShelfClient, ShelfError } from '../client';
import { useResource } from '../hooks/useResource';
import type { ShelfInfo } from '../types';
import type { ShelfOfflineOptions, ShelfSource, UseShelfResult } from './contracts';
import { ShelfContext } from './context';
import { mergeSame } from './provider/merge';
import { clientForBaseUrl, getSession } from './session';
import type { Session } from './session';

export interface ShelfSessionState {
  /** The client to resolve requests with: the session's guarded one, or the plain one before a session exists (server). */
  client: ShelfClient | null;
  /** Null on the server, while there is no client, and after the session was lost. */
  session: Session | null;
  /** The SWR engine; null until the store has opened (a few ms), on the server and when there is nothing to talk to. */
  swr: SwrImpl | null;
  lost: boolean;
  offline: ShelfOfflineOptions | undefined;
  /** Needs `needInfo`; null until /info has answered. */
  access: 'read' | 'read_write' | null;
  rootFolderId: string | null;
  discarded: number;
  infoLoaded: boolean;
}

const noopSubscribe = (): (() => void) => () => undefined;
const serverSnapshot = (): null => null;

/** props.client > props.baseUrl > nearest provider (props.cacheScope / onAuthLost refine the provider's). */
export function resolveSource(source: ShelfSource | undefined, ctx: { source: ShelfSource } | null) {
  const own = !!(source?.client || source?.baseUrl);
  const base: ShelfSource = own ? source! : (ctx?.source ?? {});
  const client = base.client ?? (base.baseUrl ? clientForBaseUrl(base.baseUrl) : null);
  const cacheScope = source?.cacheScope !== undefined ? source.cacheScope : own ? undefined : ctx?.source.cacheScope;
  const lostCallbacks = [source?.onAuthLost, own ? undefined : ctx?.source.onAuthLost];
  return { client, cacheScope, lostCallbacks };
}

/**
 * Session plumbing shared by every hook and data-bound component: resolves the source, opens (or joins) the
 * session in the browser, keeps it alive while mounted, and reports a lost session to the host once.
 *
 * On the server (no window) no session is created: the snapshot React uses there is null, so a render starts no
 * fetch, no timer and no registry entry. The first client render matches it (hydration), then the session appears.
 */
export function useShelfSessionState(source: ShelfSource | undefined, needInfo: boolean): ShelfSessionState {
  const ctx = useContext(ShelfContext);
  const { client: raw, cacheScope, lostCallbacks } = resolveSource(source, ctx);
  const [revive, bump] = useReducer((n: number) => n + 1, 0);
  const getSnapshot = useMemo(() => {
    let s: Session | null = null;
    return (): Session | null => (raw ? (s ??= getSession(raw, cacheScope)) : null);
  }, [raw, cacheScope, revive]);
  const session = useSyncExternalStore(noopSubscribe, getSnapshot, serverSnapshot);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [lostSession, setLostSession] = useState<Session | null>(null);
  const callbacks = useRef(lostCallbacks);
  callbacks.current = lostCallbacks;

  useEffect(() => {
    if (!session) return;
    if (session.disposed) {
      bump(); // idle-disposed before this mount: take a fresh one
      return;
    }
    session.retain();
    const offReady = session.onReady(rerender);
    const offDiscarded = session.onDiscarded(rerender);
    const offLost = session.onAuthLost((err: ShelfError) => {
      setLostSession(session);
      for (const cb of callbacks.current) {
        // Each distinct callback hears it once, however many hooks share the session.
        if (cb && !session.notified.has(cb)) {
          session.notified.add(cb);
          cb(err);
        }
      }
    });
    rerender(); // the store may have opened between render and this effect
    return () => {
      offReady();
      offDiscarded();
      offLost();
      session.release();
    };
  }, [session]);

  const lost = !!session && (lostSession === session || session.authLost);
  const live = session && !lost ? session : null;
  const swr = live?.parts?.swr ?? null;
  const client = live ? live.client : lost ? null : raw;

  const infoOptions = useMemo(
    () => (swr && live && needInfo ? { key: 'info', merge: mergeSame, fetcher: (signal: AbortSignal) => live.client.info({ signal }) } : null),
    [swr, live, needInfo],
  );
  const info = useResource<ShelfInfo>(swr, infoOptions).data;
  const access = info?.access === 'read_write' ? 'read_write' : info?.access === 'read' ? 'read' : null;
  const rootRaw = info?.root_folder_id ?? info?.folder_id;
  return {
    client,
    session: live,
    swr,
    lost,
    offline: ctx?.offline,
    access,
    rootFolderId: typeof rootRaw === 'string' ? rootRaw : null,
    discarded: session?.discarded ?? 0,
    infoLoaded: info !== undefined,
  };
}

/** The public result of `useShelf`. */
export function toShelfResult(s: ShelfSessionState): UseShelfResult {
  const status = s.lost ? 'auth-lost' : !s.client ? 'disconnected' : s.infoLoaded ? 'ready' : 'connecting';
  return { status, client: s.client, access: s.access, rootFolderId: s.rootFolderId, discarded: s.discarded };
}
