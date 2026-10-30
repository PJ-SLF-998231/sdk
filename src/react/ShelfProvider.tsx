import { createContext, createElement } from 'react';
import type { ShelfProviderProps, ShelfSource, UseShelfResult } from './contracts';

/** The nearest provider's source. The only createContext in the package: check-entries asserts one per output format. */
export const ShelfContext = createContext<ShelfSource | null>(null);

/**
 * STUB (0.4 U1): hands its source to descendants; no session, client creation or theme root yet. U2 replaces it
 * (props frozen in ./contracts.ts).
 */
export function ShelfProvider({ children, client, baseUrl, cacheScope, onAuthLost }: ShelfProviderProps) {
  return createElement(ShelfContext.Provider, { value: { client, baseUrl, cacheScope, onAuthLost } }, children);
}
