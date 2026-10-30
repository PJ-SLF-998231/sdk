// The smallest useful Shelf UI: the folders under the key's folder as cards, and nothing else. It imports ONLY
// FolderCard and useFolders, each from its own subpath, so a bundler ships neither the document page, nor the virtual
// list, nor the document-site renderer, nor the offline outbox. `node size.mjs` bundles it and proves that.
import { FolderCard } from '@pj-slf-998231/sdk/react/folder-card';
import { useFolders } from '@pj-slf-998231/sdk/react/hooks';
import '@pj-slf-998231/sdk/css/folder-card.css';

export function FolderCards({ baseUrl, userId, onOpen }: { baseUrl: string; userId: string; onOpen: (folderId: string) => void }) {
  const { childrenOf } = useFolders({ baseUrl, cacheScope: userId });
  return <>{childrenOf(null).map((f) => <FolderCard key={f.id} folder={f} onOpen={onOpen} />)}</>;
}
