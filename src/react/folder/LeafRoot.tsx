import { useContext } from 'react';
import type { ReactNode } from 'react';
import type { ShelfTheme } from '../contracts';
import { ShelfContext } from '../context';

/**
 * ShelfRoot for display-only components: the same `.shelf-sdk` root (nothing is drawn when one already sits above), but it
 * does not open a context for the children, because a leaf has no data-bound child that would need one. That keeps the
 * smallest entries small. A leaf must therefore never contain a component that draws a root of its own.
 */
export function LeafRoot({ theme, className, children }: { theme?: ShelfTheme; className?: string; children?: ReactNode }) {
  const ctx = useContext(ShelfContext);
  if (ctx?.inRoot) return children;
  return (
    <div className={className ? `shelf-sdk ${className}` : 'shelf-sdk'} data-theme={theme ?? ctx?.theme ?? 'light'}>
      {children}
    </div>
  );
}
