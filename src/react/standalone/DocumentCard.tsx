import type { DocumentCardProps } from '../contracts';
import { DocumentCard as Card } from '../DocumentCard';
import { ShelfRoot } from '../ShelfRoot';

/**
 * A document card for any page. Draws its own `.shelf-sdk` root (theme, className) unless it sits inside one. Thumbnails
 * come from `loader`, else straight from `client` (or the nearest provider's client), uncached; ShelfFolder and the
 * collections pass the session's cached loader.
 */
export function DocumentCard({ theme, className, ...card }: DocumentCardProps) {
  return (
    <ShelfRoot theme={theme} className={className}>
      <Card {...card} />
    </ShelfRoot>
  );
}
