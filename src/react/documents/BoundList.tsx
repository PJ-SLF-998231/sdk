import { useFolder } from '../hooks/useFolder';
import { ListView } from './DocumentList';
import type { InnerListProps } from './DocumentList';
import { useNearEnd } from './useCollection';

/** DocumentList for a `folderId`: loads the folder's documents and subfolders and fetches the next page as the end comes into view. */
export default function BoundList(props: InnerListProps) {
  const { items, subfolders, prefetchNext } = useFolder(props.folderId ?? null, props);
  const onNearEnd = useNearEnd(props.onNearEnd, prefetchNext);
  return <ListView props={props} items={items} subfolders={props.folders ?? subfolders} onNearEnd={onNearEnd} />;
}
