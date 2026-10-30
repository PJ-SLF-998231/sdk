import type { Crumb, FolderHeaderProps, ShelfSource } from '../contracts';
import { plural } from '../format';
import { useFolders } from '../hooks/useFolders';
import { useShelf } from '../hooks/useShelf';
import { NotConnected, ShelfRoot } from '../ShelfRoot';
import { Header } from './Header';
import type { View } from './Header';

function BoundHeader({ folderId, source, meta, ...rest }: View & { folderId: string | null; source: ShelfSource }) {
  const { status } = useShelf(source);
  const model = useFolders(source);
  if (status === 'disconnected' || status === 'auth-lost')
    return (
      <ShelfRoot theme={rest.theme} className={rest.className}>
        <NotConnected />
      </ShelfRoot>
    );
  const total = model.totalItems;
  const auto =
    total !== null
      ? `${plural(total, 'item')} · ${plural(model.folders.length, 'folder')}`
      : model.folders.length
        ? plural(model.folders.length, 'folder')
        : '';
  return <Header crumbs={model.pathTo(folderId)} meta={meta ?? auto} {...rest} />;
}

/**
 * The breadcrumb row of a folder view: the path, with a count on the right. Give it `crumbs`, or a `folderId` (null = the
 * key's root) to read the path through the session (props.client > props.baseUrl > nearest ShelfProvider).
 */
export function FolderHeader({ folderId = null, crumbs, client, baseUrl, cacheScope, onAuthLost, ...rest }: FolderHeaderProps) {
  if (crumbs) return <Header crumbs={crumbs} {...rest} />;
  return <BoundHeader folderId={folderId} source={{ client, baseUrl, cacheScope, onAuthLost }} {...rest} />;
}
