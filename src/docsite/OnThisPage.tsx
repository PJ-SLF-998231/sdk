// "On this page": a page's table of contents as a book has one, drawn inline
// at the top of what it lists (a document site on the Content tab,
// src/docsite). Numbered sections ("2 Key facts"), and under each its
// numbered subheadings ("2.1 Receipt number"), indented, then "+N more" when
// there are more than it lists; each entry runs a dotted leader to a
// right-hand marker (a short value, or its number). The entries and their
// numbers come from the caller (a document site's: tocEntries,
// src/docsite/toc.ts); this only draws them.
//
// Scroll-spy (useScrollSpy, src/lib/scrollSpy.ts) watches every listed
// section and subheading: the entry the reader is at has aria-current, and
// its section is marked (data-active) as well. Links are plain #anchors: the
// browser scrolls (smoothly, unless the reader asks for reduced motion,
// global.css), lands the target below the sticky nav (html's
// scroll-padding-top plus its scroll-margin-top) and the address keeps the
// place, so a section or a sub-item can be linked to. /design's own table of
// contents (src/design/Toc.tsx) uses the same scroll-spy. Its styles are the
// document site's (docsite.css, ".docsite-toc").
import { useMemo } from "react";
import { cx } from "../react/cx";
import { useScrollSpy } from "./scrollSpy";

export interface OnThisPageEntry {
  /** The target's element id. */
  id: string;
  title: string;
  /** "2", "2.1": drawn before the title, and as the marker without a value. */
  number?: string;
  /** A short value for the right-hand marker instead of the number. */
  value?: string;
}

export interface OnThisPageItem extends OnThisPageEntry {
  /** The section's subheadings, in page order. */
  subheadings?: readonly OnThisPageEntry[];
  /** How many more sub-items the section has than it lists. */
  more?: number;
}

function Entry({ entry, level, current, active }: { entry: OnThisPageEntry; level: 1 | 2; current: boolean; active?: boolean }) {
  const marker = entry.value ?? entry.number;
  return (
    <a
      className={cx("on-this-page-entry", level === 1 ? "on-this-page-entry--section" : "on-this-page-entry--sub")}
      href={`#${entry.id}`}
      onClick={(e) => {
        // Scroll inside the embed without touching the host page's address (a hash router would read it).
        const target = document.getElementById(entry.id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }}
      aria-current={current ? "location" : undefined}
      data-active={active ? "" : undefined}
    >
      {entry.number && <span className={cx("on-this-page-num")}>{entry.number}</span>}
      <span className={cx("on-this-page-title")}>{entry.title}</span>
      {marker !== undefined && (
        <>
          <span className={cx("on-this-page-leader")} aria-hidden="true" />
          {/* The number is already read before the title; a value is read. */}
          <span className={cx("on-this-page-marker")} aria-hidden={entry.value === undefined ? "true" : undefined}>
            {marker}
          </span>
        </>
      )}
    </a>
  );
}

export function OnThisPage({
  items,
  label = "On this page",
  className,
}: {
  /** The sections, in page order; each id (and each subheading's) is an element on the page. */
  items: readonly OnThisPageItem[];
  /** The navigation's name; unique on the page when it has more than one. */
  label?: string;
  className?: string;
}) {
  // Every listed id in page order (a section, then its subheadings): a
  // stable array for the spy while they stay the same (ids are slugs,
  // without spaces).
  const key = items.flatMap((i) => [i.id, ...(i.subheadings ?? []).map((s) => s.id)]).join(" ");
  const ids = useMemo(() => key.split(" "), [key]);
  const active = useScrollSpy(ids);

  return (
    <nav className={className ? `${cx("on-this-page")} ${className}` : cx("on-this-page")} aria-label={label}>
      <p className={cx("on-this-page-label")} aria-hidden="true">
        On this page
      </p>
      <ol className={cx("on-this-page-sections")}>
        {items.map((item) => {
          const subs = item.subheadings ?? [];
          const here = active === item.id || subs.some((s) => s.id === active);
          return (
            <li key={item.id} className={cx("on-this-page-section")}>
              <Entry entry={item} level={1} current={active === item.id} active={here} />
              {(subs.length > 0 || (item.more ?? 0) > 0) && (
                <ol className={cx("on-this-page-subs")}>
                  {subs.map((s) => (
                    <li key={s.id}>
                      <Entry entry={s} level={2} current={active === s.id} />
                    </li>
                  ))}
                  {(item.more ?? 0) > 0 && <li className={cx("on-this-page-more")}>+{item.more} more</li>}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
