// Scroll-spy: which of a page's sections the reader is at, for a table of
// contents to mark (OnThisPage, /design's Toc).
import { useEffect, useState } from "react";

// Where "here" is: a section is the current one once its top has scrolled
// above this line. Anchored sections land just below the sticky nav (html's
// scroll-padding-top, 84px, plus their scroll-margin-top, 16px), so the one a
// link went to is the current one.
export const SPY_LINE = 120;

// The id, of those given (in page order), of the last element whose top is
// above SPY_LINE; null above the first. The observer's box runs from far
// above the page down to the line, so an element is "intersecting" exactly
// while its top is above the line, and a jump past it (an anchor, End)
// still flips it. Pass the same array (a constant, or memoised) between
// renders: a new one starts watching again.
export function useScrollSpy(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const idOf = new Map<Element, string>();
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) idOf.set(el, id);
    }
    const above = new Set<string>();
    let observer: IntersectionObserver | null = null;
    const watch = () => {
      observer?.disconnect();
      above.clear();
      const below = Math.max(0, window.innerHeight - SPY_LINE);
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const id = idOf.get(e.target);
            if (id === undefined) continue;
            if (e.isIntersecting) above.add(id);
            else above.delete(id);
          }
          let current: string | null = null;
          for (const id of ids) if (above.has(id)) current = id;
          setActive(current);
        },
        { rootMargin: `1000000px 0px -${below}px 0px` },
      );
      for (const el of idOf.keys()) observer.observe(el);
    };
    watch();
    window.addEventListener("resize", watch);
    return () => {
      window.removeEventListener("resize", watch);
      observer?.disconnect();
    };
  }, [ids]);
  return active;
}
