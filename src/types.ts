/** Wire JSON stays snake_case; these types mirror the API exactly. */

export interface ShelfClientOptions {
  /** Base URL of the integration API; routes are relative to it (a path prefix such as /api/shelf is fine). */
  baseUrl: string;
  /** Sent as `Authorization: Bearer`. Omit when a proxy adds the key server-side. */
  apiKey?: string;
  fetch?: typeof fetch;
}

export interface ShelfItem {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  folder_id: string | null;
  /** pending, parsing, parsed, needs_review or failed; null when the document has no parse status. */
  parse_status: string | null;
  created_at: string;
  edited_at: string | null;
  parsed_at: string | null;
  /** Names of the thumbnails that exist: any of small, medium, large. Always an array. */
  preview_sizes: string[];
  /** Parser output (`word_count`, `page_count`, `sheet_names`). Only the single-document route sends it today. */
  parsed_meta?: Record<string, unknown> | null;
  /** Word count straight from the list when the API sends it (null = not parsed yet / not applicable). */
  word_count?: number | null;
  /** True when the document has a generated document site (the Content tab). Absent on older APIs: no site. */
  has_site?: boolean;
}

/** Thumbnail size names the API serves. */
export type PreviewSize = 'small' | 'medium' | 'large';

/** The single-document route's shape: the list item plus the extracted text and a download link. */
export type ShelfDocument = ShelfItem & { parsed_text?: string | null; download_url?: string };

/** Per-request options accepted as the last argument of the client's methods. */
export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ThumbnailRequestOptions extends RequestOptions {
  /** Sent as `If-None-Match`; a matching ETag answers `{status: 304}`. */
  etag?: string | null;
}

export type ThumbnailResult =
  | { status: 200; bytes: ArrayBuffer; type: string; etag: string | null }
  | { status: 304 };

export interface ShelfFolder {
  id: string;
  name: string;
  parent_id?: string | null;
  /** Live documents directly in this folder, when the API sends it. */
  item_count?: number;
  /** Live documents in this folder and everything below it, when the API sends it. */
  total_item_count?: number;
  [key: string]: unknown;
}

/** The record type of a folder. `ShelfFolder` is also the name of the React component, hence this alias. */
export type ShelfFolderRecord = ShelfFolder;

export interface ShelfInfo {
  /** The integration's id. */
  id: string;
  /** The integration's name: the platform it was made for (Shelf web's "Platform" field). */
  name: string;
  /** When the key stops working (ISO 8601), or null when it works until revoked. */
  expires_at: string | null;
  /** What the key may do: `read_write` can create, rename, move and delete folders and documents. Absent on older APIs. */
  access?: 'read' | 'read_write';
  /** The key's own folder: the top of what it reaches (never renamed, moved or deleted by the key). */
  folder?: { id: string; name: string };
  [key: string]: unknown;
}

export interface CreateFolderInput {
  name: string;
  /** Defaults to the key's folder. */
  parent_id?: string;
}

export interface UpdateFolderInput {
  name?: string;
  parent_id?: string;
}

export interface ListFilesParams {
  folder_id?: string;
  limit?: number;
  cursor?: string;
  recursive?: boolean;
}

export interface ListFilesResult {
  items: ShelfItem[];
  next_cursor?: string | null;
}

export interface UploadOptions {
  folder_id?: string;
  filename?: string;
  client_ref?: string;
  on_duplicate?: string;
}

export interface UpdateFileInput {
  filename?: string;
  folder_id?: string;
}

/** Where a document's generated site stands. */
export type SiteStatus = 'none' | 'building' | 'ready' | 'failed';

/** GET /integration/files/{id}/site. `spec` is data (a version-1 document-site spec); render it, never inject it. */
export interface ShelfSite {
  file_id: string;
  status: SiteStatus;
  /** The spec was built from older text than the document has now. */
  stale?: boolean;
  error_code?: string | null;
  error?: string | null;
  requested_at?: string | null;
  updated_at?: string | null;
  spec?: unknown;
}

/** The original file as bytes (read with the client's credentials). */
export interface OriginalResult {
  bytes: ArrayBuffer;
  type: string;
}
