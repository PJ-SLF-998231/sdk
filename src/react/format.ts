// Display helpers, ported from Shelf web (src/lib/documents.ts, folderTree.ts,
// uploadValidation.ts) with the same wording. The web app's feature flags are
// off here: a parsed document reads "Ready", as it does in Shelf without the
// parsers feature.

export type DocumentKind = 'image' | 'pdf' | 'word' | 'excel' | 'text' | 'markdown' | 'json';

const DOCUMENT_TYPES: Record<string, { kind: Exclude<DocumentKind, 'image'>; label: string; ext: string }> = {
  'application/pdf': { kind: 'pdf', label: 'PDF', ext: 'pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'word', label: 'DOCX', ext: 'docx' },
  'application/msword': { kind: 'word', label: 'DOC', ext: 'doc' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'excel', label: 'XLSX', ext: 'xlsx' },
  'application/vnd.ms-excel': { kind: 'excel', label: 'XLS', ext: 'xls' },
  'text/plain': { kind: 'text', label: 'TXT', ext: 'txt' },
  'text/markdown': { kind: 'markdown', label: 'MD', ext: 'md' },
  'application/json': { kind: 'json', label: 'JSON', ext: 'json' },
};

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** For <input accept>: MIME types plus extensions (some browsers send an empty type for .doc, .xls, .md). */
export const UPLOAD_ACCEPT = [
  ...IMAGE_TYPES,
  ...Object.keys(DOCUMENT_TYPES),
  ...Object.values(DOCUMENT_TYPES).map((t) => `.${t.ext}`),
].join(',');

/** No-break spaces keep "up to 25 MB" on one line where the hint wraps. */
export const UPLOAD_LIMITS = 'PDF, Word, Excel, text, Markdown, JSON, or scans and photos of documents · up to 25 MB';

const baseType = (contentType: string) => (contentType ?? '').split(';')[0]!.trim().toLowerCase();

export function documentKind(contentType: string): DocumentKind {
  return DOCUMENT_TYPES[baseType(contentType)]?.kind ?? 'image';
}

/** "application/pdf" -> "PDF", "image/png" -> "PNG". */
export function typeLabel(contentType: string): string {
  const known = DOCUMENT_TYPES[baseType(contentType)];
  if (known) return known.label;
  const subtype = (contentType ?? '').split('/')[1] ?? '';
  return (subtype.split('+')[0] || 'file').toUpperCase();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFormat.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFormat.format(d);
}

/** Page, word or sheet count from `parsed_meta`, when the API sent it. */
export interface ParsedMeta {
  page_count?: number;
  word_count?: number;
  sheet_names?: string[];
  [key: string]: unknown;
}

export function describeMeta(meta: ParsedMeta | null | undefined): string | null {
  if (!meta || typeof meta !== 'object') return null;
  if (meta.page_count) return plural(meta.page_count, 'page');
  if (meta.word_count) return `${meta.word_count.toLocaleString()} words`;
  if (Array.isArray(meta.sheet_names) && meta.sheet_names.length) return plural(meta.sheet_names.length, 'sheet');
  return null;
}

export type Tone = 'busy' | 'ready' | 'warn' | 'danger';


/** The status pill for a parse_status, or null when there is none. Unknown values show as they are. */
export function statusPill(status: string | null | undefined): { label: string; tone: Tone | null } | null {
  if (!status) return null;
  const s = status === 'needs_review' ? 'parsed' : status; // review is a Shelf web feature flag, off here
  switch (s) {
    case 'pending':
      return { label: 'Queued', tone: 'busy' };
    case 'parsing':
      return { label: 'Reading…', tone: 'busy' };
    case 'parsed':
      return { label: 'Ready', tone: 'ready' };
    case 'failed':
      return { label: "Couldn't read", tone: 'danger' };
    default:
      return { label: status, tone: null };
  }
}

/** A folder's caption: folders directly inside, and documents at any depth. */
export function describeContents({ folders, items }: { folders: number; items: number }): string {
  if (folders === 0 && items === 0) return 'Empty';
  const parts: string[] = [];
  if (folders > 0) parts.push(plural(folders, 'folder'));
  if (items > 0) parts.push(plural(items, 'item'));
  return parts.join(' · ');
}

const SIZE_ORDER = ['small', 'medium', 'large'];

/** Preview size names, smallest first; unknown names last. Tolerates null/undefined. */
export function orderedSizes(sizes: ReadonlyArray<string | number> | null | undefined): string[] {
  const rank = (s: string) => (SIZE_ORDER.includes(s) ? SIZE_ORDER.indexOf(s) : SIZE_ORDER.length);
  return (Array.isArray(sizes) ? sizes.map(String) : []).sort((a, b) => rank(a) - rank(b));
}
