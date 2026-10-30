import { lazy, Suspense, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { cx } from '../cx';

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

/**
 * React.lazy that, once the chunk has arrived, mounts the component directly (no suspending) for components
 * created afterwards. `preload()` fetches the chunk ahead of use. One instance never swaps implementation.
 */
function lazyPart<P extends object>(load: Loader<P>) {
  let loaded: ComponentType<P> | null = null;
  const Lazy = lazy(load);
  const preload = (): void => {
    void load().then((m) => {
      loaded = m.default;
    }).catch(() => undefined);
  };
  function Part(props: P & { fallback: ReactNode }) {
    const { fallback, ...rest } = props;
    const [ready] = useState(() => loaded);
    if (ready) {
      const C = ready as unknown as ComponentType<object>;
      return <C {...rest} />;
    }
    const L = Lazy as unknown as ComponentType<object>;
    return (
      <Suspense fallback={fallback}>
        <L {...rest} />
      </Suspense>
    );
  }
  return { Part, preload };
}

type DocumentPageProps = Parameters<typeof import('../DocumentPage').DocumentPageView>[0];
type FolderTreeProps = Parameters<typeof import('../FolderTree').FolderTree>[0];
type ActionDialogProps = Parameters<typeof import('../ActionDialog').ActionDialog>[0];
type FolderDialogProps = Parameters<typeof import('../ActionDialog').FolderDialog>[0];

/** The parts ShelfFolder loads on demand: the document page, the folder tree and the rename/move/delete form. */
export const DocumentPagePart = lazyPart<DocumentPageProps>(() => import('../DocumentPage').then((m) => ({ default: m.DocumentPageView })));
export const FolderTreePart = lazyPart<FolderTreeProps>(() => import('../FolderTree').then((m) => ({ default: m.FolderTree })));
export const ActionDialogPart = lazyPart<ActionDialogProps>(() => import('../ActionDialog').then((m) => ({ default: m.ActionDialog })));
// The same module as the item dialog, so the same chunk.
export const FolderDialogPart = lazyPart<FolderDialogProps>(() => import('../ActionDialog').then((m) => ({ default: m.FolderDialog })));

/** Fallbacks hold the space the part will take, so the page does not jump when the chunk lands. */
export const docFallback = (
  <section className={cx('doc-body')} aria-label="Document details" aria-busy="true" style={{ minHeight: 420 }}>
    <p className={cx('status-note')} role="status">
      Loading...
    </p>
  </section>
);
export const treeFallback = <div aria-busy="true" style={{ minHeight: 120 }} />;
export const dialogFallback = <div className={cx('callout')} aria-busy="true" style={{ minHeight: 72 }} />;
