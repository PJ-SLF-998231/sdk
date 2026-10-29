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
  parse_status: string;
  created_at: string;
  edited_at: string | null;
  parsed_at: string | null;
  /** Names of the thumbnails that exist: any of small, medium, large. Always an array. */
  preview_sizes: string[];
  /** Parser output (`word_count`, `page_count`, `sheet_names`). Only the single-document route sends it today. */
  parsed_meta?: Record<string, unknown> | null;
  /** Word count straight from the list when the API sends it (null = not parsed yet / not applicable). */
  word_count?: number | null;
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

export interface ShelfInfo {
  [key: string]: unknown;
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
