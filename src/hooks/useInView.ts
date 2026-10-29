import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * True once `ref`'s element has come within `rootMargin` of the viewport; stays true afterwards.
 * Without IntersectionObserver it is true straight away (everything loads immediately).
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = '200px', enabled = true): boolean {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!enabled || seen || !supported) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, enabled, seen, supported]);
  return !enabled || !supported || seen;
}
