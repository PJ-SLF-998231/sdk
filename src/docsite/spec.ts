// The document-site spec, version 1: the types mirror the api's JSON Schema
// (api docs/document-site.schema.json, https://shelf.tri2b.cloud/schemas/document-site.v1.json)
// exactly, snake_case and all, and the validators below check one block at a
// time against it, so the renderer can skip a bad block and keep the rest.
// Hand-written on purpose: the app has no JSON Schema or validation library.

export const SPEC_VERSION = 1;

/** Where a fact was read: a 1-based page (form-feed separated) and line. */
export interface SourceRef {
  page?: number;
  line?: number;
}

export interface HeroProps {
  title: string;
  kind: string;
  issuer?: string;
  /** YYYY, YYYY-MM or YYYY-MM-DD. */
  date?: string;
}

export interface KeyFact {
  label: string;
  /** Optional short heading for the table of contents (TOC_TITLE_MAX); a derived label stands in without it. */
  title?: string;
  value: string;
  source?: SourceRef;
}

export interface KeyFactsProps {
  items: KeyFact[];
}

export interface Total {
  label: string;
  /** Optional short heading for the table of contents (TOC_TITLE_MAX); a derived label stands in without it. */
  title?: string;
  /** A plain decimal, no grouping or symbol: 1234.50, -3. */
  value: string;
  /** ISO 4217 code. */
  currency?: string;
  source?: SourceRef;
}

export interface AmountProps extends Total {
  totals?: Total[];
}

export interface Party {
  name: string;
  /** Optional short heading for the table of contents (TOC_TITLE_MAX); a derived label stands in without it. */
  title?: string;
  lines?: string[];
  source?: SourceRef;
}

export interface PartiesProps {
  from?: Party;
  to?: Party;
}

export interface SummaryProps {
  text: string;
  source?: SourceRef;
}

export interface TableProps {
  columns: string[];
  /** One cell per column; a cell may be "". */
  rows: string[][];
  source?: SourceRef;
}

export interface TimelineItem {
  date: string;
  label: string;
  /** Optional short heading for the table of contents (TOC_TITLE_MAX); a derived label stands in without it. */
  title?: string;
  source?: SourceRef;
}

export interface TimelineProps {
  items: TimelineItem[];
}

/**
 * A stored site may still carry an `entities` block (removed from the
 * contract): it is not drawn as its own section but folded into Key facts
 * (foldEntities below). Only its shape is kept, for that fold.
 */
type EntityKind =
  | "person"
  | "organization"
  | "place"
  | "date"
  | "amount"
  | "identifier"
  | "contact"
  | "other";

interface LegacyEntity {
  kind: EntityKind;
  value: string;
}

export interface SourceProps {
  pages?: number;
  note: string;
}

export type Block =
  | { type: "hero"; props: HeroProps }
  | { type: "key_facts"; props: KeyFactsProps }
  | { type: "amount"; props: AmountProps }
  | { type: "parties"; props: PartiesProps }
  | { type: "summary"; props: SummaryProps }
  | { type: "table"; props: TableProps }
  | { type: "timeline"; props: TimelineProps }
  | { type: "source"; props: SourceProps };

export type BlockType = Block["type"];

export interface DocSiteSpec {
  version: 1;
  generated_at: string;
  source: {
    text_hash: string;
    parser_id?: string | null;
    parser_revision?: number | null;
  };
  blocks: Block[];
}

/**
 * The fixed layout order (the /design standards, "Layout order"): blocks are
 * drawn in this order whatever order the spec lists them in. The site's
 * "On this page" (DocSite) sits between the summary and the rest:
 * title, summary, table of contents, then the rest.
 */
export const LAYOUT_ORDER: readonly BlockType[] = [
  "hero",
  "summary",
  "key_facts",
  "amount",
  "parties",
  "timeline",
  "table",
  "source",
];

/** How many of each block a spec may have (schema: each once, tables up to 3). */
export const MAX_PER_TYPE: Readonly<Record<BlockType, number>> = {
  hero: 1,
  summary: 1,
  key_facts: 1,
  amount: 1,
  parties: 1,
  timeline: 1,
  table: 3,
  source: 1,
};

/** The schema's blocks maxItems. */
export const MAX_BLOCKS = 12;

const ENTITY_KINDS: readonly EntityKind[] = [
  "person",
  "organization",
  "place",
  "date",
  "amount",
  "identifier",
  "contact",
  "other",
];

/**
 * The longest sub-item `title` taken. Not in schema v1 yet: an additive,
 * optional field the api may add (L15) for the table of contents; tolerated
 * here so a spec carrying it is not skipped, and left out of AmountProps'
 * own label (the amount's heading is its label).
 */
export const TOC_TITLE_MAX = 120;

const titled = (obj: Obj, path: string) => optional(obj, "title", (v) => plain(v, `${path}.title`, TOC_TITLE_MAX));

export function isBlockType(type: unknown): type is BlockType {
  return typeof type === "string" && (LAYOUT_ORDER as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Validation. Each check throws a SpecError naming the path that failed;
// validateBlock turns that into a result.

class SpecError extends Error {}

function fail(path: string, message: string): never {
  throw new SpecError(`${path}: ${message}`);
}

type Obj = Record<string, unknown>;

function object(value: unknown, path: string, allowed: readonly string[], required: readonly string[] = []): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "is not an object");
  const obj = value as Obj;
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "is not allowed");
  }
  for (const key of required) {
    if (!(key in obj)) fail(`${path}.${key}`, "is required");
  }
  return obj;
}

function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, "is not an array");
  if (value.length < min) fail(path, `has fewer than ${min} items`);
  if (value.length > max) fail(path, `has more than ${max} items`);
  return value;
}

// The schema's $defs/plain: not blank, no control characters, nothing that
// reads as HTML or Markdown.
const CONTROL = /[\x00-\x1F\x7F]/; // eslint-disable-line no-control-regex
const MARKUP = /<[A-Za-z/!?]|\]\(|\*\*|__|`|^#{1,6}\s|^\s*[-*+>]\s/;

function plain(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string") fail(path, "is not a string");
  if (!/\S/.test(value)) fail(path, "is blank");
  if (CONTROL.test(value)) fail(path, "has a control character");
  if (MARKUP.test(value)) fail(path, "reads as HTML or Markdown");
  // JSON Schema's maxLength counts code points, not UTF-16 units.
  if ([...value].length > maxLength) fail(path, `is longer than ${maxLength} characters`);
  return value;
}

const DATE = /^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$/;
const DECIMAL = /^-?[0-9]{1,15}(\.[0-9]{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;

function pattern(value: unknown, path: string, re: RegExp, what: string): string {
  if (typeof value !== "string" || !re.test(value)) fail(path, `is not ${what}`);
  return value;
}

function integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value)) fail(path, "is not an integer");
  if (value < min || value > max) fail(path, `is not between ${min} and ${max}`);
  return value;
}

function optional<T>(obj: Obj, key: string, check: (value: unknown) => T): void {
  if (key in obj) check(obj[key]);
}

function ref(value: unknown, path: string): void {
  const obj = object(value, path, ["page", "line"]);
  if (Object.keys(obj).length === 0) fail(path, "is empty");
  optional(obj, "page", (v) => integer(v, `${path}.page`, 1));
  optional(obj, "line", (v) => integer(v, `${path}.line`, 1));
}

function total(value: unknown, path: string, extra: readonly string[] = []): Obj {
  const obj = object(value, path, ["label", "value", "currency", "source", ...extra], ["label", "value"]);
  if (extra.includes("title")) titled(obj, path);
  plain(obj.label, `${path}.label`, 60);
  pattern(obj.value, `${path}.value`, DECIMAL, "a plain decimal");
  optional(obj, "currency", (v) => pattern(v, `${path}.currency`, CURRENCY, "an ISO 4217 code"));
  optional(obj, "source", (v) => ref(v, `${path}.source`));
  return obj;
}

function party(value: unknown, path: string): void {
  const obj = object(value, path, ["name", "title", "lines", "source"], ["name"]);
  plain(obj.name, `${path}.name`, 120);
  titled(obj, path);
  optional(obj, "lines", (v) => array(v, `${path}.lines`, 0, 4).forEach((line, i) => plain(line, `${path}.lines[${i}]`, 120)));
  optional(obj, "source", (v) => ref(v, `${path}.source`));
}

const PROPS: Record<BlockType, (props: unknown, path: string) => void> = {
  hero(value, path) {
    const p = object(value, path, ["title", "kind", "issuer", "date"], ["title", "kind"]);
    plain(p.title, `${path}.title`, 120);
    plain(p.kind, `${path}.kind`, 40);
    optional(p, "issuer", (v) => plain(v, `${path}.issuer`, 120));
    optional(p, "date", (v) => pattern(v, `${path}.date`, DATE, "a date"));
  },
  key_facts(value, path) {
    const p = object(value, path, ["items"], ["items"]);
    array(p.items, `${path}.items`, 1, 20).forEach((item, i) => {
      const at = `${path}.items[${i}]`;
      const it = object(item, at, ["label", "title", "value", "source"], ["label", "value"]);
      plain(it.label, `${at}.label`, 60);
      titled(it, at);
      plain(it.value, `${at}.value`, 200);
      optional(it, "source", (v) => ref(v, `${at}.source`));
    });
  },
  amount(value, path) {
    const p = total(value, path, ["totals"]);
    optional(p, "totals", (v) => array(v, `${path}.totals`, 1, 10).forEach((t, i) => total(t, `${path}.totals[${i}]`, ["title"])));
  },
  parties(value, path) {
    const p = object(value, path, ["from", "to"]);
    if (Object.keys(p).length === 0) fail(path, "has neither from nor to");
    optional(p, "from", (v) => party(v, `${path}.from`));
    optional(p, "to", (v) => party(v, `${path}.to`));
  },
  summary(value, path) {
    const p = object(value, path, ["text", "source"], ["text"]);
    plain(p.text, `${path}.text`, 600);
    optional(p, "source", (v) => ref(v, `${path}.source`));
  },
  table(value, path) {
    const p = object(value, path, ["columns", "rows", "source"], ["columns", "rows"]);
    const columns = array(p.columns, `${path}.columns`, 1, 8);
    columns.forEach((c, i) => plain(c, `${path}.columns[${i}]`, 40));
    array(p.rows, `${path}.rows`, 1, 50).forEach((row, r) => {
      const at = `${path}.rows[${r}]`;
      // The schema leaves row width to the validator: one cell per column.
      const cells = array(row, at, columns.length, columns.length);
      cells.forEach((cell, c) => {
        if (cell !== "") plain(cell, `${at}[${c}]`, 200);
      });
    });
    optional(p, "source", (v) => ref(v, `${path}.source`));
  },
  timeline(value, path) {
    const p = object(value, path, ["items"], ["items"]);
    array(p.items, `${path}.items`, 1, 20).forEach((item, i) => {
      const at = `${path}.items[${i}]`;
      const it = object(item, at, ["date", "label", "title", "source"], ["date", "label"]);
      titled(it, at);
      pattern(it.date, `${at}.date`, DATE, "a date");
      plain(it.label, `${at}.label`, 120);
      optional(it, "source", (v) => ref(v, `${at}.source`));
    });
  },
  source(value, path) {
    const p = object(value, path, ["pages", "note"], ["note"]);
    optional(p, "pages", (v) => integer(v, `${path}.pages`, 1, 10000));
    plain(p.note, `${path}.note`, 200);
  },
};

/** Checks a stored `entities` block's props (the shape it had in schema v1). */
function legacyEntities(value: unknown, path: string): LegacyEntity[] {
  const p = object(value, path, ["items"], ["items"]);
  return array(p.items, `${path}.items`, 1, 30).map((item, i) => {
    const at = `${path}.items[${i}]`;
    const it = object(item, at, ["kind", "value"], ["kind", "value"]);
    if (!(ENTITY_KINDS as readonly unknown[]).includes(it.kind)) fail(`${at}.kind`, "is not a known kind");
    plain(it.value, `${at}.value`, 120);
    return { kind: it.kind as EntityKind, value: it.value as string };
  });
}

/** "organization" -> "Organization": a stored entity kind as a key fact's label. */
export function entityLabel(kind: string): string {
  return kind
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const same = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Folds a stored site's entities into its Key facts (a copy; the stored spec
 * is not changed): each becomes a fact labelled with its humanised kind,
 * appended after the existing facts, unless its value is already a key fact's
 * or a party's (name or line), compared ignoring case and spacing. Later
 * duplicates among the entities go too. Without a key_facts block, one is
 * made. Changes the list of prepared blocks in place, nothing else.
 */
function foldEntities(
  valid: { block: Block; index: number }[],
  entities: { items: LegacyEntity[]; index: number },
): void {
  const facts = valid.find((v) => v.block.type === "key_facts");
  const taken = new Set<string>();
  for (const { block } of valid) {
    if (block.type === "key_facts") block.props.items.forEach((it) => taken.add(same(it.value)));
    if (block.type === "parties") {
      for (const party of [block.props.from, block.props.to]) {
        if (!party) continue;
        taken.add(same(party.name));
        party.lines?.forEach((line) => taken.add(same(line)));
      }
    }
  }
  const added: KeyFact[] = [];
  for (const { kind, value } of entities.items) {
    const key = same(value);
    if (taken.has(key)) continue;
    taken.add(key);
    added.push({ label: entityLabel(kind), value });
  }
  if (added.length === 0) return;
  if (facts && facts.block.type === "key_facts") {
    facts.block = { type: "key_facts", props: { items: [...facts.block.props.items, ...added] } };
  } else {
    valid.push({ block: { type: "key_facts", props: { items: added } }, index: entities.index });
  }
}

export type BlockResult = { ok: true; block: Block } | { ok: false; reason: string };

/** Checks one block against schema v1. */
export function validateBlock(value: unknown, path = "block"): BlockResult {
  try {
    const obj = object(value, path, ["type", "props"], ["type", "props"]);
    if (!isBlockType(obj.type)) {
      fail(`${path}.type`, `is not a known block type (${JSON.stringify(obj.type)})`);
    }
    PROPS[obj.type](obj.props, `${path}.props`);
    return { ok: true, block: obj as unknown as Block };
  } catch (err) {
    if (err instanceof SpecError) return { ok: false, reason: err.message };
    throw err;
  }
}

/** A block the renderer left out, and why. */
export interface SkippedBlock {
  /** The block's index in the spec's blocks, or -1 for the spec itself. */
  index: number;
  type: string | null;
  reason: string;
}

export interface PreparedSite {
  /** The blocks to draw, valid and in layout order. */
  blocks: Block[];
  skipped: SkippedBlock[];
}

/**
 * Validates a spec block by block and puts what passes in layout order.
 * A spec that is not version 1 or has no blocks array gives no blocks; a
 * block of an unknown type, one that fails the schema, one over its type's
 * limit or past the twelfth is skipped. The spec's other fields are not used
 * for drawing and are not checked here (the api checks them).
 */
export function prepareSite(spec: unknown): PreparedSite {
  const skipped: SkippedBlock[] = [];
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    return { blocks: [], skipped: [{ index: -1, type: null, reason: "spec: is not an object" }] };
  }
  const { version, blocks } = spec as Obj;
  if (version !== SPEC_VERSION) {
    return { blocks: [], skipped: [{ index: -1, type: null, reason: `spec.version: is not ${SPEC_VERSION}` }] };
  }
  if (!Array.isArray(blocks)) {
    return { blocks: [], skipped: [{ index: -1, type: null, reason: "spec.blocks: is not an array" }] };
  }

  const counts = new Map<BlockType, number>();
  const valid: { block: Block; index: number }[] = [];
  let entities: { items: LegacyEntity[]; index: number } | undefined;
  blocks.forEach((raw, index) => {
    const rawType = typeof raw === "object" && raw !== null ? (raw as Obj).type : undefined;
    const type = typeof rawType === "string" ? rawType : null;
    if (index >= MAX_BLOCKS) {
      skipped.push({ index, type, reason: `blocks[${index}]: past the ${MAX_BLOCKS}-block limit` });
      return;
    }
    if (type === "highlights") return; // removed from the contract: a stored one is ignored
    if (type === "entities") {
      // Removed from the contract: a stored one is folded into Key facts below.
      if (entities) {
        skipped.push({ index, type, reason: `blocks[${index}]: more than 1 entities block(s)` });
        return;
      }
      try {
        const items = legacyEntities((raw as Obj).props, `blocks[${index}].props`);
        entities = { items, index };
      } catch (err) {
        if (!(err instanceof SpecError)) throw err;
        skipped.push({ index, type, reason: err.message });
      }
      return;
    }
    const result = validateBlock(raw, `blocks[${index}]`);
    if (!result.ok) {
      skipped.push({ index, type, reason: result.reason });
      return;
    }
    const seen = counts.get(result.block.type) ?? 0;
    if (seen >= MAX_PER_TYPE[result.block.type]) {
      skipped.push({
        index,
        type,
        reason: `blocks[${index}]: more than ${MAX_PER_TYPE[result.block.type]} ${result.block.type} block(s)`,
      });
      return;
    }
    counts.set(result.block.type, seen + 1);
    valid.push({ block: result.block, index });
  });

  if (entities) foldEntities(valid, entities);
  valid.sort(
    (a, b) => LAYOUT_ORDER.indexOf(a.block.type) - LAYOUT_ORDER.indexOf(b.block.type) || a.index - b.index,
  );
  return { blocks: valid.map((v) => v.block), skipped };
}
