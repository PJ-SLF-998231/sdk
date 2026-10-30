import type { ShelfComponentProps } from '../contracts';
import { OfflineBanner as Banner } from '../OfflineBanner';
import { LeafRoot } from '../folder/LeafRoot';

/** Offline / "Syncing N changes…" notice with its own `.shelf-sdk` root unless it already sits in one. Nothing when online and idle. */
export function OfflineBanner({ online, waiting, theme, className }: { online: boolean; waiting: number } & ShelfComponentProps) {
  if (online && waiting === 0) return null;
  return (
    <LeafRoot theme={theme} className={className}>
      <Banner online={online} waiting={waiting} />
    </LeafRoot>
  );
}
