import type { ShelfComponentProps } from '../contracts';
import { FolderTree as Tree } from '../FolderTree';
import type { FolderTreeProps } from '../FolderTree';
import { LeafRoot } from '../folder/LeafRoot';

export type { FolderTreeProps };

/** The sidebar folder tree with its own `.shelf-sdk` root unless it already sits in one. */
export function FolderTree({ theme, className, ...props }: FolderTreeProps & ShelfComponentProps) {
  return (
    <LeafRoot theme={theme} className={className}>
      <Tree {...props} />
    </LeafRoot>
  );
}
