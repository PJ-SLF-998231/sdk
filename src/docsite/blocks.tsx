// The document-site blocks (the /design standards, "Blocks"). Each draws
// one block of a validated spec from the app's own pieces (kicker, card-meta,
// callout, tag, item-list) and the docsite.css rules, with the tokens only.
// Read-only: nothing here is a field or a link, and the only buttons are the
// copy buttons beside values (CopyValue), except the original
// file's link in the source footer, which comes from the app, never the spec.
// Every string from the spec is set as text, never as HTML.

import { cx } from "../react/cx";
import { createElement, useId, type ReactNode } from "react";
import { CopyValue } from "./CopyValue";
import { formatAmount, formatDate, formatFigure, formatRef } from "./format";
import { BLOCK_TITLES } from "./sections";
import { partyId, subItemId, timelineOrder } from "./toc";
import type {
  AmountProps,
  HeroProps,
  KeyFactsProps,
  PartiesProps,
  Party,
  SourceProps,
  SourceRef,
  SummaryProps,
  TableProps,
  TimelineProps,
} from "./spec";

/**
 * A link target the site may draw: http(s) or a path on the host (the SDK's own original route). Anything else
 * (javascript:, data:, vbscript:, protocol-relative) is dropped; the spec itself never supplies a link.
 */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const t = url.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("/") && !t.startsWith("//")) return t;
  return undefined;
}

export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

/** A block drawn at a heading level: its own heading's (the hero's title's). */
export interface BlockComponentProps<P> {
  props: P;
  level: HeadingLevel;
  /**
   * The section's id, its slug (sections.ts), for the site's "On this page"
   * links. Its sub-items take ids from it (toc.ts: subItemId, partyId), for
   * the subheadings' links.
   */
  id?: string;
}

/** A sub-item's anchor id, when the section has one. */
const sub = (id: string | undefined, n: number) => (id ? subItemId(id, n) : undefined);

function Heading({
  level,
  id,
  className,
  children,
}: {
  level: HeadingLevel;
  id?: string;
  className: string;
  children: ReactNode;
}) {
  return createElement(`h${level}`, { id, className }, children);
}

/** "Page 1 · Line 12", after the value it backs, in card meta. */
export function SourceNote({ source, as = "span" }: { source?: SourceRef; as?: "span" | "dd" }) {
  if (!source) return null;
  return createElement(as, { className: cx("docsite-src") }, formatRef(source));
}

function BlockSection({
  level,
  title,
  id,
  headingId,
  children,
}: {
  level: HeadingLevel;
  title: string;
  id?: string;
  headingId?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("docsite-block")} id={id}>
      <Heading level={level} id={headingId} className={cx("docsite-h")}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

export function Hero({ props, level, titleId }: BlockComponentProps<HeroProps> & { titleId?: string }) {
  const meta = props.issuer || props.date;
  return (
    <header className={cx("docsite-hero")}>
      <p className={cx("kicker")}>{props.kind}</p>
      <Heading level={level} id={titleId} className={cx("docsite-title")}>
        {props.title}
      </Heading>
      {meta && (
        <p className={cx("card-meta")}>
          {props.issuer}
          {props.issuer && props.date && " · "}
          {props.date && <time dateTime={props.date}>{formatDate(props.date)}</time>}
        </p>
      )}
    </header>
  );
}

export function Summary({ props, level, id }: BlockComponentProps<SummaryProps>) {
  return (
    <BlockSection level={level} title={BLOCK_TITLES.summary} id={id}>
      <p className={cx("docsite-text")}>{props.text}</p>
      <SourceNote source={props.source} />
    </BlockSection>
  );
}

export function KeyFacts({ props, level, id }: BlockComponentProps<KeyFactsProps>) {
  return (
    <BlockSection level={level} title={BLOCK_TITLES.key_facts} id={id}>
      <dl className={cx("docsite-facts")}>
        {props.items.map((item, i) => (
          <div key={i} id={sub(id, i + 1)}>
            <dt>{item.label}</dt>
            <dd>
              <CopyValue value={item.value} label={item.label}>
                {item.value}
              </CopyValue>
            </dd>
            <SourceNote source={item.source} as="dd" />
          </div>
        ))}
      </dl>
    </BlockSection>
  );
}

/** Amount and totals: the figure large, then the lines that make it up. */
export function Amount({ props, level, id }: BlockComponentProps<AmountProps>) {
  return (
    <BlockSection level={level} title={props.label} id={id}>
      <p className={cx("docsite-figure")}>
        <CopyValue value={formatAmount(props.value, props.currency)} label={props.label}>
          {props.currency && (
            <>
              <span className={cx("docsite-currency")}>{props.currency}</span>{" "}
            </>
          )}
          {formatFigure(props.value)}
        </CopyValue>
      </p>
      <SourceNote source={props.source} />
      {props.totals && (
        <dl className={cx("docsite-totals")}>
          {props.totals.map((total, i) => (
            <div key={i} id={sub(id, i + 1)}>
              <dt>
                {total.label}
                <SourceNote source={total.source} />
              </dt>
              <dd>
                <CopyValue value={formatAmount(total.value, total.currency)} label={total.label}>
                  {formatAmount(total.value, total.currency)}
                </CopyValue>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </BlockSection>
  );
}

function PartyEntry({ label, party, id }: { label: string; party: Party; id?: string }) {
  return (
    <div id={id}>
      <dt>{label}</dt>
      <dd>
        <CopyValue value={party.name} label={label}>
          {party.name}
        </CopyValue>
      </dd>
      {party.lines?.map((line, i) => (
        <dd key={i} className={cx("docsite-party-line")}>
          <CopyValue value={line}>{line}</CopyValue>
        </dd>
      ))}
      <SourceNote source={party.source} as="dd" />
    </div>
  );
}

export function Parties({ props, level, id }: BlockComponentProps<PartiesProps>) {
  return (
    <BlockSection level={level} title={BLOCK_TITLES.parties} id={id}>
      <dl className={cx("docsite-facts")}>
        {props.from && <PartyEntry label="From" party={props.from} id={id ? partyId(id, "from") : undefined} />}
        {props.to && <PartyEntry label="To" party={props.to} id={id ? partyId(id, "to") : undefined} />}
      </dl>
    </BlockSection>
  );
}

/** Dated events in date order (ISO strings sort as dates; ties keep their order). */
export function Timeline({ props, level, id }: BlockComponentProps<TimelineProps>) {
  // Numbered in drawn order, as the table of contents numbers them.
  const items = timelineOrder(props.items);
  return (
    <BlockSection level={level} title={BLOCK_TITLES.timeline} id={id}>
      <ol className={cx("docsite-timeline")}>
        {items.map((item, i) => (
          <li key={i} id={sub(id, i + 1)}>
            <time dateTime={item.date}>{formatDate(item.date)}</time>
            <span>
              <CopyValue value={item.label}>{item.label}</CopyValue>
            </span>
            <SourceNote source={item.source} />
          </li>
        ))}
      </ol>
    </BlockSection>
  );
}

// A cell that is a figure: digits with grouping, a decimal part, an optional
// sign, currency code or per cent. Columns of figures are right-aligned.
const FIGURE = /^[+\-−]?(?:[A-Z]{3}\s?)?[+\-−]?\d[\d,.\s']*%?$/;

function numericColumns(props: TableProps): boolean[] {
  return props.columns.map((_, c) => {
    const cells = props.rows.map((row) => row[c] ?? "").filter((cell) => cell !== "");
    return cells.length > 0 && cells.every((cell) => FIGURE.test(cell.trim()));
  });
}

export function Table({ props, level, id, title = "Items" }: BlockComponentProps<TableProps> & { title?: string }) {
  const headingId = useId();
  const numeric = numericColumns(props);
  const num = (c: number) => (numeric[c] ? cx("item-list-num") : undefined);
  return (
    <BlockSection level={level} title={title} id={id} headingId={headingId}>
      <div className={cx("item-list-scroll")}>
        <table className={cx("item-list")} aria-labelledby={headingId}>
          <thead>
            <tr>
              {props.columns.map((column, c) => (
                <th key={c} scope="col" className={num(c)}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={num(c)}>
                    <CopyValue value={cell} label={`${props.columns[c] ?? "cell"} ${r + 1}`}>
                      {cell}
                    </CopyValue>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote source={props.source} />
    </BlockSection>
  );
}

/**
 * The source footer, last: the pages the document has, the spec's note, and
 * the one link on the site, to the original file (from the app). Drawn with
 * just the link when the spec has no source block.
 */
export function SourceFooter({
  props,
  level,
  id,
  originalUrl,
  originalLabel = "Open the original file",
}: {
  props?: SourceProps;
  level: HeadingLevel;
  id?: string;
  originalUrl?: string;
  originalLabel?: string;
}) {
  return (
    <footer className={cx("docsite-block docsite-source")} id={id}>
      <Heading level={level} className={cx("docsite-h")}>
        {BLOCK_TITLES.source}
      </Heading>
      {props?.pages !== undefined && (
        <p className={cx("card-meta")}>
          {props.pages} {props.pages === 1 ? "page" : "pages"}
        </p>
      )}
      {props && <p className={cx("docsite-note")}>{props.note}</p>}
      {safeHref(originalUrl) && (
        <a className={cx("docsite-original")} href={safeHref(originalUrl)}>
          {originalLabel}
        </a>
      )}
    </footer>
  );
}
