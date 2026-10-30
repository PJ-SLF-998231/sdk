import type { ThumbLoader } from '../../internal/contracts';
import type { DocumentGalleryProps } from '../contracts';
import { useFolder } from '../hooks/useFolder';
import { VirtualGallery } from './VirtualGallery';
import { useNearEnd } from './useCollection';

/** DocumentGallery for a `folderId`: loads the folder's documents and fetches the next page as the end comes into view. */
export default function BoundGallery(props: DocumentGalleryProps & { loader: ThumbLoader }) {
  const { items, prefetchNext } = useFolder(props.folderId ?? null, props);
  const onNearEnd = useNearEnd(props.onNearEnd, prefetchNext);
  return <VirtualGallery {...props} items={items} onNearEnd={onNearEnd} />;
}
