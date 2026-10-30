// A document site's table of contents, as a book has one: numbered sections
// ("1 Key facts", "2 Parties") and under each, numbered subheadings
// ("1.1 Receipt number") taken from the block's own sub-items, at most
// TOC_MAX_SUBHEADINGS of them and then "+N more". Each entry has a right-hand
// marker after the dotted leader: a short value where one is to hand (an
// amount, a date, a party's role), the entry's number otherwise.
//
// Pure and framework-free: no React, no DOM. The mobile app ports this file
// so both apps number a site the same way; keep it that way. The labels come
// from the spec, no new calls: an optional sub-item `title` (an additive
// field schema v1 may gain) wins over the derived label when it is there.
//
// Every subheading links to a stable anchor id on the sub-item the renderer
// (blocks.tsx) draws, built with subItemId/partyId below: the same spec
// gives the same ids, whatever order its blocks came in.

import { formatAmount, formatDate } from "./format";
import { siteSections, SITE_ID_PREFIX, tocSections, type SiteSection } from "./sections";
import { prepareSite, type TimelineItem } from "./spec";

/** Subheadings listed under a section; the rest are "+N more". */
export const TOC_MAX_SUBHEADINGS = 5;

/** A derived label (an item's text) is cut to this many characters, at a word. */
export const TOC_LABEL_MAX = 60;

export interface TocSubheading {
  /** "2.1": the section's number, a dot, its place under the section. */
  number: string;
  /** Its words: the sub-item's `title`, or the label derived from it. */
  title: string;
  /** The rendered sub-item's element id (subItemId, partyId). */
  id: string;
  /** A short value for the right-hand marker (an amount, a date, "From"); absent: the number is the marker. */
  value?: string;
}

export interface TocSection {
  /** "2": its place in the table of contents, from 1. */
  number: string;
  /** The section heading's words, as drawn. */
  title: string;
  /** The section's element id (its slug, sections.ts). */
  id: string;
  /** A short value for the right-hand marker (the amount's figure); absent: the number is the marker. */
  value?: string;
  /** At most TOC_MAX_SUBHEADINGS, in the order they are drawn. */
  subheadings: TocSubheading[];
  /** How many sub-items are not listed ("+N more"); 0 when all are. */
  more: number;
}

/** The anchor id of a block's nth sub-item (1-based, in drawn order): "site-key-facts-2". */
export const subItemId = (sectionId: string, n: number) => `${sectionId}-${n}`;

/** The anchor id of a party: "site-parties-from", "site-parties-to". */
export const partyId = (sectionId: string, role: "from" | "to") => `${sectionId}-${role}`;

/**
 * A timeline's items in the order they are drawn: by date (ISO strings sort
 * as dates), ties keeping the spec's order.
 */
export function timelineOrder<T extends Pick<TimelineItem, "date">>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : a.i - b.i))
    .map(({ item }) => item);
}

/** Cuts a derived label to max characters (code points) at a word, with an ellipsis. */
export function shortLabel(text: string, max = TOC_LABEL_MAX): string {
  const clean = text.trim().replace(/\s+/g, " ");
  const chars = [...clean];
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:–—-]+$/, "")}…`;
}

/** An optional `title` on a sub-item, when it is there and not blank. */
function titleOf(item: object): string | undefined {
  const title = (item as { title?: unknown }).title;
  return typeof title === "string" && /\S/.test(title) ? title.trim() : undefined;
}

type Sub = Omit<TocSubheading, "number">;

function subItems(section: SiteSection): { value?: string; items: Sub[] } {
  const { id, block } = section;
  if (!block) return { items: [] };
  switch (block.type) {
    case "key_facts":
      return { items: block.props.items.map((it, i) => ({ title: titleOf(it) ?? it.label, id: subItemId(id, i + 1) })) };
    case "amount":
      return {
        value: formatAmount(block.props.value, block.props.currency),
        items: (block.props.totals ?? []).map((t, i) => ({
          title: titleOf(t) ?? t.label,
          id: subItemId(id, i + 1),
          value: formatAmount(t.value, t.currency),
        })),
      };
    case "parties": {
      const items: Sub[] = [];
      if (block.props.from) items.push({ title: titleOf(block.props.from) ?? block.props.from.name, id: partyId(id, "from"), value: "From" });
      if (block.props.to) items.push({ title: titleOf(block.props.to) ?? block.props.to.name, id: partyId(id, "to"), value: "To" });
      return { items };
    }
    case "timeline":
      return {
        items: timelineOrder(block.props.items).map((it, i) => ({ title: titleOf(it) ?? it.label, id: subItemId(id, i + 1), value: formatDate(it.date) })),
      };
    default:
      // summary (not listed), table (its heading is its caption: "Items",
      // "Items n of m"; rows are not headings) and source: no subheadings.
      return { items: [] };
  }
}

/**
 * The table of contents of sections already chosen for it (tocSections:
 * those drawn after it, in order), numbered from 1.
 */
export function tocFromSections(sections: readonly SiteSection[]): TocSection[] {
  return sections.map((section, s) => {
    const number = String(s + 1);
    const { value, items } = subItems(section);
    const entry: TocSection = {
      number,
      title: section.title,
      id: section.id,
      subheadings: items.slice(0, TOC_MAX_SUBHEADINGS).map((sub, k) => ({ number: `${number}.${k + 1}`, ...sub })),
      more: Math.max(0, items.length - TOC_MAX_SUBHEADINGS),
    };
    if (value !== undefined) entry.value = value;
    return entry;
  });
}

export interface TocOptions {
  /** Whether the source footer is drawn: a source block, or the original file's link. Defaults to whether the spec has a source block. */
  footer?: boolean;
  /** The slug prefix, "site" unless the page has more than one site. */
  idPrefix?: string;
}

/**
 * A spec's table of contents: the sections drawn after the title and the
 * summary, numbered, each with its numbered subheadings. Takes the spec as
 * the api sent it (checked here, like the renderer: bad blocks are left out).
 */
export function tocEntries(spec: unknown, { footer, idPrefix = SITE_ID_PREFIX }: TocOptions = {}): TocSection[] {
  const { blocks } = prepareSite(spec);
  const withFooter = footer ?? blocks.some((b) => b.type === "source");
  return tocFromSections(tocSections(siteSections(blocks, { footer: withFooter, idPrefix })));
}
