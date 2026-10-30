import { useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ShelfTheme } from './contracts';
import { ShelfContext } from './context';
import { cx } from './cx';
import { plural } from './format';

export function rootClassName(className?: string): string {
  return ['shelf-sdk', className].filter(Boolean).join(' ');
}

/**
 * Draws a `.shelf-sdk` root (theme, className) around `children` unless one is already drawn above, in which
 * case the children render as they are. The theme defaults to the provider's, then 'light'.
 */
export function ShelfRoot({ theme, className, children }: { theme?: ShelfTheme; className?: string; children?: ReactNode }) {
  const ctx = useContext(ShelfContext);
  const inner = useMemo(() => ({ ...ctx, source: ctx?.source ?? {}, inRoot: true }), [ctx]);
  if (ctx?.inRoot) return <>{children}</>;
  const t: string = theme ?? ctx?.theme ?? 'light';
  return (
    <div className={rootClassName(className)} data-theme={t}>
      <ShelfContext.Provider value={inner}>{children}</ShelfContext.Provider>
    </div>
  );
}

/** The "Shelf isn't connected" callout, the markup ShelfFolder draws (inside the caller's root). `discarded` = queued changes thrown away with a lost session. */
export function NotConnected({ discarded = 0 }: { discarded?: number }) {
  return (
    <div className={cx('callout', 'notice')} role="alert">
      <strong>Shelf isn&apos;t connected</strong>
      <p>The document store is not set up for this site yet.</p>
      {discarded > 0 && (
        <p data-testid="shelf-discarded">
          {plural(discarded, 'pending change')} could not be sent and {discarded === 1 ? 'was' : 'were'} discarded.
        </p>
      )}
    </div>
  );
}

/** ShelfRoot around NotConnected, for a data-bound component that has no client. */
export function NotConnectedRoot({ theme, className, discarded }: { theme?: ShelfTheme; className?: string; discarded?: number }) {
  return (
    <ShelfRoot theme={theme} className={className}>
      <NotConnected discarded={discarded} />
    </ShelfRoot>
  );
}
