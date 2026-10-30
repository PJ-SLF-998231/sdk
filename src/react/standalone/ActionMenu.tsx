import { ActionMenu as Menu } from '../ActionMenu';
import type { MenuAction } from '../ActionMenu';
import type { ShelfComponentProps } from '../contracts';
import { LeafRoot } from '../folder/LeafRoot';

/** The "⋯" menu with its own `.shelf-sdk` root unless it already sits in one. */
export function ActionMenu({ theme, className, ...props }: { label: string; actions: MenuAction[] } & ShelfComponentProps) {
  return (
    <LeafRoot theme={theme} className={className}>
      <Menu {...props} />
    </LeafRoot>
  );
}
