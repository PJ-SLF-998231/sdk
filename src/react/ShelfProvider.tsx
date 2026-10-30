import { useMemo } from 'react';
import type { ShelfProviderProps } from './contracts';
import { ShelfContext } from './context';
import { useShelfSessionState } from './useShelfSession';

/**
 * Gives the hooks and data-bound components below it one Shelf: a client (or base URL), a cache scope, an
 * auth-lost callback, offline options and a theme. Hooks and components still take their own `client` / `baseUrl`
 * when they need another Shelf. The provider keeps the session open while it is mounted, so a consumer that
 * remounts finds its data.
 */
export function ShelfProvider({ children, client, baseUrl, cacheScope, onAuthLost, offline, theme }: ShelfProviderProps) {
  const outbox = offline?.outbox;
  const concurrency = offline?.uploadConcurrency;
  const attempts = offline?.maxAttempts;
  const value = useMemo(
    () => ({
      source: { client, baseUrl, cacheScope, onAuthLost },
      offline: outbox === undefined && concurrency === undefined && attempts === undefined ? undefined : { outbox, uploadConcurrency: concurrency, maxAttempts: attempts },
      theme,
    }),
    [client, baseUrl, cacheScope, onAuthLost, outbox, concurrency, attempts, theme],
  );
  // Outside any provider this resolves from the provider's own props: it only keeps the session alive and watches for auth loss.
  useShelfSessionState(value.source, false);
  return <ShelfContext.Provider value={value}>{children}</ShelfContext.Provider>;
}
