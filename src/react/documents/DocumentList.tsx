import { lazy, Suspense } from 'react';
import type { ThumbLoader } from '../../internal/contracts';
import type { DocumentListProps, OverlayFolder } from '../contracts';
import { NotConnectedRoot, ShelfRoot } from '../ShelfRoot';
import { useCollectionLoader, useNearEnd } from './useCollection';
import type { VirtualGalleryProps } from './VirtualGallery';
import { FolderRow, VirtualTable } from './VirtualTable';
export { FolderRow, VirtualTable };
export type { VirtualTableProps } from './VirtualTable';

export type InnerListProps = DocumentListProps & { loader: ThumbLoader };

export function ListView({ props, items, subfolders, onNearEnd }: { props: InnerListProps; items: VirtualGalleryProps['items']; subfolders: readonly OverlayFolder[]; onNearEnd: () => void }) {
  const folderRows = subfolders.map((f) => (
    <FolderRow key={`d-${f.id}`} folder={f} caption={props.folderCaption?.(f)} onOpen={props.onOpenFolder} actions={props.folderActions?.(f)} />
  ));
  return <VirtualTable {...props} items={items} folderRows={folderRows} folderCount={subfolders.length} onNearEnd={onNearEnd} />;
}

// Loading a folder (useFolder) is a lazy chunk: a list handed `items` never pays for it.
const BoundList = lazy(() => import('./BoundList'));

function PureList(props: InnerListProps) {
  const onNearEnd = useNearEnd(props.onNearEnd);
  return <ListView props={props} items={props.items ?? []} subfolders={props.folders ?? []} onNearEnd={onNearEnd} />;
}

/**
 * The documents of a folder as a virtualised table, with `folders` as rows above them. Give it `items`, or a `folderId`
 * to load them (a page is fetched ahead as the end comes into view; the folder's subfolders are the rows unless `folders` is given).
 */
export function DocumentList(props: DocumentListProps) {
  const { loader, connected } = useCollectionLoader(props);
  const bound = !props.items && props.folderId !== undefined;
  if (bound && !connected) return <NotConnectedRoot theme={props.theme} className={props.className} />;
  return <ShelfRoot theme={props.theme} className={props.className}>{bound ? (
        <Suspense fallback={null}>
          <BoundList {...props} loader={loader} />
        </Suspense>
      ) : <PureList {...props} loader={loader} />}</ShelfRoot>;
}
