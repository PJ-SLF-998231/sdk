import type {
  ListFilesParams,
  ListFilesResult,
  ShelfClientOptions,
  ShelfFolder,
  ShelfInfo,
  ShelfItem,
  UpdateFileInput,
  UploadOptions,
} from './types';

export class ShelfError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'ShelfError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export interface ShelfClient {
  info(): Promise<ShelfInfo>;
  folders(): Promise<ShelfFolder[]>;
  listFiles(params?: ListFilesParams): Promise<ListFilesResult>;
  getFile(id: string): Promise<ShelfItem>;
  upload(file: Blob, opts?: UploadOptions): Promise<ShelfItem>;
  updateFile(id: string, patch: UpdateFileInput): Promise<ShelfItem>;
  deleteFile(id: string): Promise<void>;
  /** `size` is a preview size name as listed in `preview_sizes`: small, medium or large. */
  thumbnailUrl(id: string, size?: string | number): string;
  originalUrl(id: string, filename: string): string;
}

export function createShelfClient(options: ShelfClientOptions): ShelfClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const apiKey = options.apiKey;
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  const enc = encodeURIComponent;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
    const res = await doFetch(base + path, { ...init, headers, credentials: 'same-origin' });
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    info: () => request<ShelfInfo>('/'),

    async folders() {
      const body = await request<ShelfFolder[] | { folders?: ShelfFolder[] | null; items?: ShelfFolder[] | null } | null>('/folders');
      if (Array.isArray(body)) return body;
      return body?.folders ?? body?.items ?? [];
    },

    listFiles(params = {}) {
      const q = new URLSearchParams();
      if (params.folder_id) q.set('folder_id', params.folder_id);
      if (params.limit !== undefined) q.set('limit', String(params.limit));
      if (params.cursor) q.set('cursor', params.cursor);
      if (params.recursive !== undefined) q.set('recursive', String(params.recursive));
      const qs = q.toString();
      return request<unknown>('/files' + (qs ? `?${qs}` : '')).then(normaliseList);
    },

    getFile: (id) => request<ShelfItem>(`/files/${enc(id)}`).then(normaliseItem),

    upload(file, opts = {}) {
      const form = new FormData();
      const name = opts.filename ?? (file as File).name;
      if (name) form.append('file', file, name);
      else form.append('file', file);
      if (opts.folder_id) form.append('folder_id', opts.folder_id);
      if (opts.client_ref) form.append('client_ref', opts.client_ref);
      if (opts.on_duplicate) form.append('on_duplicate', opts.on_duplicate);
      return request<ShelfItem>('/files', { method: 'POST', body: form }).then(normaliseItem);
    },

    updateFile: (id, patch) =>
      request<ShelfItem>(`/files/${enc(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(normaliseItem),

    async deleteFile(id) {
      await request<void>(`/files/${enc(id)}`, { method: 'DELETE' });
    },

    thumbnailUrl: (id, size) => `${base}/files/${enc(id)}/thumbnail` + (size !== undefined ? `?size=${size}` : ''),

    originalUrl: (id, filename) => `${base}/files/${enc(id)}/original/${enc(filename)}`,
  };
}

/** The API answers `{files: [...], next_cursor}`; any list may arrive as null or be missing. */
function normaliseList(body: unknown): ListFilesResult {
  const b = (body ?? {}) as { files?: ShelfItem[] | null; items?: ShelfItem[] | null; next_cursor?: string | null };
  const rows = Array.isArray(b.files) ? b.files : Array.isArray(b.items) ? b.items : [];
  return { items: rows.map(normaliseItem), next_cursor: b.next_cursor ?? null };
}

function normaliseItem(item: ShelfItem): ShelfItem {
  return Array.isArray(item?.preview_sizes) ? item : { ...item, preview_sizes: [] };
}

async function toError(res: Response): Promise<ShelfError> {
  let code = 'http_error';
  let message = res.statusText || `HTTP ${res.status}`;
  let field: string | undefined;
  try {
    const body = (await res.json()) as { code?: string; message?: string; error?: string; field?: string };
    if (body.code) code = body.code;
    else if (body.error) code = body.error;
    if (body.message) message = body.message;
    if (body.field) field = body.field;
  } catch {
    /* non-JSON error body */
  }
  return new ShelfError(res.status, code, message, field);
}
