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
  preview_sizes: number[];
}

export interface ShelfFolder {
  id: string;
  name: string;
  parent_id?: string | null;
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
