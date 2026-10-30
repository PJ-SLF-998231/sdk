// A document site: the display-only page on a document's Content tab, drawn
// from the api's site spec (version 1). The spec is checked block by block
// (spec.ts): a block of an unknown type or one that fails the schema is
// skipped and logged, and the rest are drawn in the fixed layout order.
// After the hero and the summary comes "On this page", a book-style table of
// contents of the sections drawn after it (sections.ts), numbered, each with
// up to five numbered subheadings from its sub-items (toc.ts, tocEntries),
// when there are three sections or more (title, summary, table of contents,
// rest). Everything inside is the document's text, so the whole
// site is ph-no-capture.

import { useEffect, useId, useMemo, type ReactNode } from "react";
import { cx } from "../react/cx";
import { OnThisPage } from "./OnThisPage";
import {
  Amount,
  Hero,
  KeyFacts,
  Parties,
  SourceFooter,
  Summary,
  Table,
  Timeline,
  type HeadingLevel,
} from "./blocks";
import { isAboveToc, MIN_TOC_SECTIONS, SITE_ID_PREFIX, siteSections, tocSections, type SiteSection } from "./sections";
import { prepareSite, type SkippedBlock } from "./spec";
import { tocFromSections } from "./toc";

export interface DocSiteProps {
  /** The site spec as the api sent it; checked here, so any JSON will do. */
  spec: unknown;
  /** The original file's URL: the site's one link out, in the source footer. */
  originalUrl?: string;
  /** The link's words. */
  originalLabel?: string;
  /**
   * The hero title's heading level, one below the host page's heading (2
   * under the document page's h1). Block headings are one level below it.
   */
  headingLevel?: 2 | 3 | 4 | 5;
  /** Called once per skipped block (and for a spec that is not v1). Defaults to console.warn. */
  onSkip?: (skipped: SkippedBlock) => void;
  /** Drawn instead when no block is left to draw. */
  fallback?: ReactNode;
  /** Whether to draw "On this page" after the summary (when it would list three sections or more). On by default. */
  toc?: boolean;
  /** Its navigation's name: unique on a page with more than one site (/design). */
  tocLabel?: string;
  /** The sections' slug prefix ("site"): unique on a page with more than one site. */
  idPrefix?: string;
}

function logSkip(skipped: SkippedBlock) {
  console.warn("docsite: skipped block", skipped);
}

export function DocSite({
  spec,
  originalUrl,
  originalLabel,
  headingLevel = 2,
  onSkip = logSkip,
  fallback = null,
  toc = true,
  tocLabel,
  idPrefix = SITE_ID_PREFIX,
}: DocSiteProps) {
  const site = useMemo(() => prepareSite(spec), [spec]);
  const titleId = useId();
  const hasSource = site.blocks.some((b) => b.type === "source");
  const footer = hasSource || Boolean(originalUrl);
  const sections = useMemo(() => siteSections(site.blocks, { footer, idPrefix }), [site, footer, idPrefix]);

  useEffect(() => {
    site.skipped.forEach((s) => onSkip(s));
    // Logged once per spec, not on every render with a new onSkip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  if (site.blocks.length === 0) return <>{fallback}</>;

  const hero = site.blocks.find((b) => b.type === "hero");
  // Without a hero, block headings take the hero's level so none is skipped.
  const blockLevel = (hero ? headingLevel + 1 : headingLevel) as HeadingLevel;
  const footerSection = footer ? sections[sections.length - 1] : undefined;
  const listed = tocFromSections(tocSections(sections));
  const body = sections.filter((s) => s !== footerSection);

  const draw = ({ id, title, block }: SiteSection) => {
    if (!block) return null;
    switch (block.type) {
      case "summary":
        return <Summary key={id} id={id} props={block.props} level={blockLevel} />;
      case "key_facts":
        return <KeyFacts key={id} id={id} props={block.props} level={blockLevel} />;
      case "amount":
        return <Amount key={id} id={id} props={block.props} level={blockLevel} />;
      case "parties":
        return <Parties key={id} id={id} props={block.props} level={blockLevel} />;
      case "timeline":
        return <Timeline key={id} id={id} props={block.props} level={blockLevel} />;
      case "table":
        return <Table key={id} id={id} props={block.props} level={blockLevel} title={title} />;
      default:
        // The hero is drawn first; the source footer last, below.
        return null;
    }
  };

  return (
    <article
      className={cx("docsite")}
      {...(hero ? { "aria-labelledby": titleId } : { "aria-label": "Document site" })}
    >
      {hero?.type === "hero" && <Hero props={hero.props} level={headingLevel} titleId={titleId} />}
      {body.filter(isAboveToc).map(draw)}
      {toc && listed.length >= MIN_TOC_SECTIONS && <OnThisPage items={listed} label={tocLabel} className={cx("docsite-toc")} />}
      {body.filter((s) => !isAboveToc(s)).map(draw)}
      {footerSection && (
        <SourceFooter
          id={footerSection.id}
          props={footerSection.block?.type === "source" ? footerSection.block.props : undefined}
          level={blockLevel}
          originalUrl={originalUrl}
          originalLabel={originalLabel}
        />
      )}
    </article>
  );
}
