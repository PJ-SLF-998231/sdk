import { useEffect, useRef, useState } from 'react';
import type { ThumbProps } from '../internal/contracts';
import { useInView } from '../hooks/useInView';
import { cx } from './cx';
import { pickPreviewSize } from './previewSize';

/**
 * A thumbnail that is fetched through the ThumbLoader only once it is near the viewport. The box it sits in
 * is sized by the caller's CSS (aspect-ratio / fixed size), so the image arriving moves nothing. With no
 * available size it renders only `fallback`.
 */
export function Thumb({ loader, id, available, version, alt, width, height, fallback, className, lazy = true }: ThumbProps) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const size = pickPreviewSize(width, dpr, available);
  const sentinel = useRef<HTMLSpanElement>(null);
  const inView = useInView(sentinel, '200px', lazy && size !== null);
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${id}|${size}|${version ?? ''}`;
  const url = size ? (loaded?.key === key ? loaded.url : loader.peek(id, size)) : null;

  useEffect(() => {
    if (!size || !inView || url) return;
    const ac = new AbortController();
    loader
      .load({ id, size, version, signal: ac.signal })
      .then((u) => {
        if (!ac.signal.aborted) setLoaded({ key, url: u });
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoaded({ key, url: null });
      });
    return () => ac.abort();
    // `url` is deliberately not a dependency: it only flips once this very load has finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, id, size, version, inView, key]);

  if (url) return <img src={url} alt={alt} width={width} height={height} className={className} draggable={false} decoding="async" />;
  return (
    <>
      {fallback}
      {size && <span ref={sentinel} className={cx('thumb-sentinel')} aria-hidden="true" />}
    </>
  );
}
