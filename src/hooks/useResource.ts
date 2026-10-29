import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SwrOptions, SwrState } from '../internal/contracts';
import type { SwrImpl } from '../cache/swr';

export interface ResourceState<T> extends SwrState<T> {
  /** Revalidate now. */
  refresh: () => Promise<void>;
}

const IDLE: SwrState<never> = { data: undefined, stale: false, loading: false, error: undefined, offline: false, fromCache: false, updatedAt: null };
const noopSubscribe = (): (() => void) => () => undefined;

/**
 * Renders `data` from the cache at once and revalidates in the background. Pass `swr` or `options` as
 * null to stay idle (no host cache yet, or nothing to load).
 */
export function useResource<T>(swr: SwrImpl | null, options: SwrOptions<T> | null): ResourceState<T> {
  // handle() also hands the newest fetcher/merge to the shared handle; the key picks the handle.
  const handle = swr && options ? swr.handle<T>(options) : null;
  const subscribe = useCallback((cb: () => void) => (handle ? handle.subscribe(cb) : noopSubscribe()), [handle]);
  const getSnapshot = useCallback(() => (handle ? handle.snapshot() : (IDLE as SwrState<T>)), [handle]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(() => (handle ? handle.refresh() : Promise.resolve()), [handle]);
  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}
