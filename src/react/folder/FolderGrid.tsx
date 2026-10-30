import type { FolderGridProps, ShelfSource } from '../contracts';
import type { OverlayFolder } from '../../internal/contracts';
import { cx } from '../cx';
import { useFolders } from '../hooks/useFolders';
import { useShelf } from '../hooks/useShelf';
import { NotConnected } from '../ShelfRoot';
import { count, folderCaption } from './caption';
import { LeafRoot } from './LeafRoot';
import { FolderCardBody } from './FolderCard';

type Props = Pick<FolderGridProps, 'onOpenFolder' | 'folderActions'>;

function Grid({
  folders,
  caption,
  onOpenFolder,
  folderActions,
}: Props & {
  folders: readonly OverlayFolder[];
  caption: (f: OverlayFolder) => string | null;
}) {
  if (folders.length === 0) return null;
  return (
    <div className={cx('folder-grid')}>
      {folders.map((f) => (
        <FolderCardBody key={f.id} folder={f} caption={caption(f) ?? undefined} sync={f.sync} actions={folderActions?.(f)} onOpen={onOpenFolder} />
      ))}
    </div>
  );
}

/** Caption from the records alone: the counts the API sent with each folder. */
function recordCaption(f: OverlayFolder, all: readonly OverlayFolder[]): string | null {
  const kids = all.filter((c) => c.parent_id === f.id).length;
  const items = typeof f.total_item_count === 'number' ? f.total_item_count : f.item_count;
  if (typeof items === 'number') return folderCaption(kids, items);
  return kids > 0 ? count(kids, 'folder') : null;
}

function BoundGrid({
  folderId,
  source,
  theme,
  className,
  ...rest
}: Props & {
  folderId: string | null;
  source: ShelfSource;
  theme?: FolderGridProps['theme'];
  className?: string;
}) {
  const { status } = useShelf(source);
  const model = useFolders(source);
  if (status === 'disconnected' || status === 'auth-lost')
    return (
      <LeafRoot theme={theme} className={className}>
        <NotConnected />
      </LeafRoot>
    );
  const folders = model.childrenOf(folderId);
  const caption = (f: OverlayFolder): string | null => {
    const kids = model.childrenOf(f.id).length;
    if (model.totals) return folderCaption(kids, model.totals.get(f.id) ?? 0);
    return kids > 0 ? count(kids, 'folder') : null; // document counts unknown: say nothing rather than guess
  };
  return (
    <LeafRoot theme={theme} className={className}>
      <Grid folders={folders} caption={caption} {...rest} />
    </LeafRoot>
  );
}

/**
 * The subfolders of a folder as a grid of FolderCards. Give it `folders`, or a `folderId` (null = the key's root) to read them
 * through the session (props.client > props.baseUrl > nearest ShelfProvider).
 */
export function FolderGrid({
  folderId = null,
  folders,
  onOpenFolder,
  folderActions,
  theme,
  className,
  client,
  baseUrl,
  cacheScope,
  onAuthLost,
}: FolderGridProps) {
  if (folders) {
    return (
      <LeafRoot theme={theme} className={className}>
        <Grid folders={folders} caption={(f) => recordCaption(f, folders)} onOpenFolder={onOpenFolder} folderActions={folderActions} />
      </LeafRoot>
    );
  }
  return (
    <BoundGrid
      folderId={folderId}
      source={{ client, baseUrl, cacheScope, onAuthLost }}
      theme={theme}
      className={className}
      onOpenFolder={onOpenFolder}
      folderActions={folderActions}
    />
  );
}
