import { lazy, Suspense } from 'react';
import type { ThumbLoader } from '../../internal/contracts';
import type { DocumentGalleryProps } from '../contracts';
import { NotConnectedRoot, ShelfRoot } from '../ShelfRoot';
import { VirtualGallery } from './VirtualGallery';
export { VirtualGallery };
export type { VirtualGalleryProps } from './VirtualGallery';
import { useCollectionLoader, useNearEnd } from './useCollection';

// Loading a folder (useFolder) is a lazy chunk: a gallery handed `items` never pays for it.
const BoundGallery = lazy(() => import('./BoundGallery'));

function PureGallery(props: DocumentGalleryProps & { loader: ThumbLoader }) {
  const onNearEnd = useNearEnd(props.onNearEnd);
  return <VirtualGallery {...props} items={props.items ?? []} onNearEnd={onNearEnd} />;
}

/**
 * The documents of a folder as a virtualised card gallery. Give it `items` (display only: pass `client` or sit inside a
 * ShelfProvider for thumbnails), or a `folderId` to load them (a page is fetched ahead as the end comes into view).
 */
export function DocumentGallery(props: DocumentGalleryProps) {
  const { loader, connected } = useCollectionLoader(props);
  const bound = !props.items && props.folderId !== undefined;
  if (bound && !connected) return <NotConnectedRoot theme={props.theme} className={props.className} />;
  return <ShelfRoot theme={props.theme} className={props.className}>{bound ? (
        <Suspense fallback={null}>
          <BoundGallery {...props} loader={loader} />
        </Suspense>
      ) : <PureGallery {...props} loader={loader} />}</ShelfRoot>;
}
