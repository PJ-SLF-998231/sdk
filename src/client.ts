import type {
  ListFilesParams,
  ListFilesResult,
  OriginalResult,
  RequestOptions,
  ShelfClientOptions,
  ShelfFolder,
  ShelfInfo,
  ShelfItem,
  ShelfSite,
  ThumbnailRequestOptions,
  ThumbnailResult,
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
  /** The base URL this client talks to, trailing slashes removed. */
  readonly baseUrl: string;
  info(opts?: RequestOptions): Promise<ShelfInfo>;
  folders(opts?: RequestOptions): Promise<ShelfFolder[]>;
  listFiles(params?: ListFilesParams, opts?: RequestOptions): Promise<ListFilesResult>;
  getFile(id: string, opts?: RequestOptions): Promise<ShelfItem>;
  upload(file: Blob, opts?: UploadOptions, req?: RequestOptions): Promise<ShelfItem>;
  updateFile(id: string, patch: UpdateFileInput, req?: RequestOptions): Promise<ShelfItem>;
  deleteFile(id: string, req?: RequestOptions): Promise<void>;
  /** `size` is a preview size name as listed in `preview_sizes`: small, medium or large. */
  thumbnailUrl(id: string, size?: string | number): string;
  /**
   * Fetches a thumbnail with the client's credentials. With `etag` it sends `If-None-Match` and a
   * matching answer is `{status: 304}` (keep the cached bytes).
   */
  thumbnail?(id: string, size: string | number, opts?: ThumbnailRequestOptions): Promise<ThumbnailResult>;
  originalUrl(id: string, filename: string): string;
  /** The original file's bytes, fetched with the client's credentials (for the document page's preview). */
  original?(id: string, filename: string, opts?: RequestOptions): Promise<OriginalResult>;
  /** The document's generated site (GET /files/{id}/site). 404 when the document has none or the API predates sites. */
  getSite(id: string, opts?: RequestOptions): Promise<ShelfSite>;
}

/** The session is no longer authorised: a 401, or the proxy's 503 `not_configured` (key revoked/unset). */
export function isAuthLost(err: unknown): boolean {
  if (!(err instanceof ShelfError)) return false;
  return err.status === 401 || (err.status === 503 && err.code === 'not_configured');
}

/** The server could not be reached or is down (keep cached data). Never true for an abort. */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof ShelfError) return err.status === 502 || (err.status === 503 && err.code !== 'not_configured');
  if ((err as { name?: string } | null)?.name === 'AbortError') return false;
  return err instanceof TypeError;
}

export function createShelfClient(options: ShelfClientOptions): ShelfClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const apiKey = options.apiKey;
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  const enc = encodeURIComponent;

  function headersFor(init: RequestInit, accept: string): Headers {
    const headers = new Headers(init.headers);
    headers.set('Accept', accept);
    if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
    return headers;
  }

  async function request<T>(path: string, init: RequestInit = {}, req?: RequestOptions): Promise<T> {
    const headers = headersFor(init, 'application/json');
    const res = await doFetch(base + path, { ...init, headers, credentials: 'same-origin', ...(req?.signal ? { signal: req.signal } : {}) });
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    baseUrl: base,

    info: (o) => request<ShelfInfo>('/', {}, o),

    async folders(o) {
      const body = await request<ShelfFolder[] | { folders?: ShelfFolder[] | null; items?: ShelfFolder[] | null } | null>('/folders', {}, o);
      if (Array.isArray(body)) return body;
      return body?.folders ?? body?.items ?? [];
    },

    listFiles(params = {}, o) {
      const q = new URLSearchParams();
      if (params.folder_id) q.set('folder_id', params.folder_id);
      if (params.limit !== undefined) q.set('limit', String(params.limit));
      if (params.cursor) q.set('cursor', params.cursor);
      if (params.recursive !== undefined) q.set('recursive', String(params.recursive));
      const qs = q.toString();
      return request<unknown>('/files' + (qs ? `?${qs}` : ''), {}, o).then(normaliseList);
    },

    getFile: (id, o) => request<ShelfItem>(`/files/${enc(id)}`, {}, o).then(normaliseItem),

    upload(file, opts = {}, req) {
      const form = new FormData();
      const name = opts.filename ?? (file as File).name;
      if (name) form.append('file', file, name);
      else form.append('file', file);
      if (opts.folder_id) form.append('folder_id', opts.folder_id);
      if (opts.client_ref) form.append('client_ref', opts.client_ref);
      if (opts.on_duplicate) form.append('on_duplicate', opts.on_duplicate);
      return request<ShelfItem>('/files', { method: 'POST', body: form }, req).then(normaliseItem);
    },

    updateFile: (id, patch, req) =>
      request<ShelfItem>(`/files/${enc(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }, req).then(normaliseItem),

    async deleteFile(id, req) {
      await request<void>(`/files/${enc(id)}`, { method: 'DELETE' }, req);
    },

    thumbnailUrl: (id, size) => `${base}/files/${enc(id)}/thumbnail` + (size !== undefined ? `?size=${size}` : ''),

    async thumbnail(id, size, opts = {}) {
      const headers = headersFor({}, 'image/*');
      if (opts.etag) headers.set('If-None-Match', opts.etag);
      const res = await doFetch(`${base}/files/${enc(id)}/thumbnail?size=${size}`, {
        headers,
        credentials: 'same-origin',
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (res.status === 304) return { status: 304 };
      if (!res.ok) throw await toError(res);
      const bytes = await res.arrayBuffer();
      return { status: 200, bytes, type: res.headers.get('Content-Type') ?? 'application/octet-stream', etag: res.headers.get('ETag') };
    },

    originalUrl: (id, filename) => `${base}/files/${enc(id)}/original/${enc(filename)}`,

    async original(id, filename, opts = {}) {
      const res = await doFetch(`${base}/files/${enc(id)}/original/${enc(filename)}`, {
        headers: headersFor({}, '*/*'),
        credentials: 'same-origin',
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) throw await toError(res);
      return { bytes: await res.arrayBuffer(), type: res.headers.get('Content-Type') ?? 'application/octet-stream' };
    },

    getSite: (id, o) => request<ShelfSite>(`/files/${enc(id)}/site`, {}, o),
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
