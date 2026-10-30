// A document site's sections: the blocks DocSite draws under a heading, in
// the order it draws them, each with its heading's text and a stable slug id.
// Worked out from the same prepared (validated, ordered) spec the renderer
// draws, so the site's "On this page" lists exactly what is on the page.
//
// The hero is the site's title, not a section. "On this page" sits after the
// summary (title, summary, table of contents, rest) and lists the
// sections drawn after it (tocSections): the summary is above it, not listed.
//
// The hero is the site's title, not a section. A slug is the prefix and the
// block's type ("site-summary", "site-key-facts", "site-source"), and a
// table's number when there is more than one ("site-table-2"): the same for
// the same spec, whatever its labels say, so a link to a section keeps
// working when the site is built again.
import type { Block } from "./spec";

/**
 * The headings of the blocks whose heading is a fixed word or two (Amount's
 * is its label, a table's "Items" or "Items n of m"): what the blocks (blocks.tsx)
 * draw and what the site's "On this page" lists.
 */
export const BLOCK_TITLES = {
  summary: "Summary",
  key_facts: "Key facts",
  parties: "Parties",
  timeline: "Timeline",
  source: "Source",
} as const;

export interface SiteSection {
  /** The section's element id: its slug. */
  id: string;
  /** Its heading's text. */
  title: string;
  /** The block drawn there; none for a source footer with only the original's link. */
  block?: Block;
}

/** The prefix of every slug on a document's page; "site-" keeps them apart from the app's own ids. */
export const SITE_ID_PREFIX = "site";

/** "On this page" is drawn when it would list this many sections or more. */
export const MIN_TOC_SECTIONS = 3;

const slugOf = (type: string) => type.replace(/_/g, "-");

/**
 * The sections of the prepared blocks, in their order. footer: whether the
 * source footer is drawn (a source block, or the original file's link);
 * a source block in the list is that footer, not a second one.
 */
export function siteSections(blocks: readonly Block[], { footer, idPrefix = SITE_ID_PREFIX }: { footer: boolean; idPrefix?: string }): SiteSection[] {
  const tables = blocks.filter((b) => b.type === "table").length;
  let tableNumber = 0;
  const sections: SiteSection[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "hero":
      case "source":
        break;
      case "amount":
        sections.push({ id: `${idPrefix}-amount`, title: block.props.label, block });
        break;
      case "table":
        tableNumber += 1;
        sections.push(
          tables > 1
            ? { id: `${idPrefix}-table-${tableNumber}`, title: `Items ${tableNumber} of ${tables}`, block }
            : { id: `${idPrefix}-table`, title: "Items", block },
        );
        break;
      default:
        sections.push({ id: `${idPrefix}-${slugOf(block.type)}`, title: BLOCK_TITLES[block.type], block });
    }
  }
  if (footer) {
    sections.push({ id: `${idPrefix}-source`, title: BLOCK_TITLES.source, block: blocks.find((b) => b.type === "source") });
  }
  return sections;
}

/** Whether a section is drawn above "On this page" (the summary), not listed in it. */
export const isAboveToc = (section: SiteSection) => section.block?.type === "summary";

/** The sections "On this page" lists: those drawn after it, the source footer included. */
export function tocSections(sections: readonly SiteSection[]): SiteSection[] {
  return sections.filter((s) => !isAboveToc(s));
}
