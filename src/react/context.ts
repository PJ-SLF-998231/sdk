import { createContext } from 'react';
import type { DocumentTabId, ShelfOfflineOptions, ShelfSource, ShelfTheme } from './contracts';

export interface ShelfContextValue {
  /** What the nearest ShelfProvider was given. Hooks and components resolve their client from it (see useShelfSession). */
  source: ShelfSource;
  offline?: ShelfOfflineOptions;
  theme?: ShelfTheme;
  /** Document page defaults the provider was given; a page's own props win. */
  showPreviewSizes?: boolean;
  documentTabs?: readonly DocumentTabId[];
  /** A `.shelf-sdk` root is already drawn above (ShelfRoot sets it), so a nested component does not draw another. */
  inRoot?: boolean;
}

/**
 * The only createContext in the package: check-entries asserts exactly one per output format, so provider, hooks and
 * components must all import it from here and the module stays one shared chunk.
 */
export const ShelfContext = createContext<ShelfContextValue | null>(null);
