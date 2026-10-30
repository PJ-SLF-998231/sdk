import type { DocumentPreviewTabProps } from '../contracts';
import { NotConnectedRoot, ShelfRoot } from '../ShelfRoot';
import { useShelfSessionState } from '../useShelfSession';
import { PreviewPanel } from './PreviewPanel';

/** A document's original shown where the browser can: images (with a size bar unless `showPreviewSizes` is false), PDFs, text. */
export function DocumentPreviewTab({ document: doc, client, loader, showPreviewSizes, theme, className }: DocumentPreviewTabProps) {
  const s = useShelfSessionState(client ? { client } : undefined, false);
  const c = client ?? s.client;
  if (!c) return <NotConnectedRoot theme={theme} className={className} />;
  return (
    <ShelfRoot theme={theme} className={className}>
      <PreviewPanel client={c} loader={loader ?? s.session?.parts?.loader ?? null} doc={doc} showPreviewSizes={showPreviewSizes} />
    </ShelfRoot>
  );
}
