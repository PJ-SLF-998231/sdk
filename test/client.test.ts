import { describe, expect, it, vi } from 'vitest';
import { createShelfClient, isAuthLost, isOfflineError, ShelfError } from '../src';

const item = { id: 'f1', filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 3, folder_id: 'd1', parse_status: 'done', created_at: 't', edited_at: null, parsed_at: null, preview_sizes: ['small'] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(res: () => Response, opts: { baseUrl?: string; apiKey?: string } = {}) {
  const fetchMock = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => res());
  const client = createShelfClient({ baseUrl: opts.baseUrl ?? 'https://x.test/api/v1/integration', apiKey: opts.apiKey, fetch: fetchMock as unknown as typeof fetch });
  const call = () => {
    const [url, init] = fetchMock.mock.calls[0]!;
    return { url: String(url), init: init as RequestInit, headers: new Headers((init as RequestInit).headers) };
  };
  return { client, call, fetchMock };
}

describe('routes', () => {
  it('info GET /', async () => {
    const { client, call } = setup(() => json({ name: 'shelf' }));
    expect(await client.info()).toEqual({ name: 'shelf' });
    expect(call().url).toBe('https://x.test/api/v1/integration/');
  });
  it('folders GET /folders', async () => {
    const { client, call } = setup(() => json({ folders: [{ id: 'd1', name: 'A' }] }));
    expect(await client.folders()).toEqual([{ id: 'd1', name: 'A' }]);
    expect(call().url).toMatch(/\/folders$/);
  });
  it('listFiles builds the query', async () => {
    const { client, call } = setup(() => json({ files: [item], next_cursor: null }));
    await client.listFiles({ folder_id: 'd1', limit: 10, cursor: 'c', recursive: true });
    const u = new URL(call().url);
    expect(u.pathname).toBe('/api/v1/integration/files');
    expect(Object.fromEntries(u.searchParams)).toEqual({ folder_id: 'd1', limit: '10', cursor: 'c', recursive: 'true' });
  });
  it('getFile', async () => {
    const { client, call } = setup(() => json(item));
    expect((await client.getFile('f1')).preview_sizes).toEqual(['small']);
    expect(call().url).toMatch(/\/files\/f1$/);
  });
  it('upload sends multipart fields', async () => {
    const { client, call } = setup(() => json(item, 201));
    await client.upload(new Blob(['abc']), { folder_id: 'd1', filename: 'a.pdf', client_ref: 'r1', on_duplicate: 'rename' });
    const { init } = call();
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect([...form.keys()].sort()).toEqual(['client_ref', 'file', 'folder_id', 'on_duplicate']);
    expect((form.get('file') as File).name).toBe('a.pdf');
    expect(form.get('folder_id')).toBe('d1');
    expect(form.get('client_ref')).toBe('r1');
    expect(form.get('on_duplicate')).toBe('rename');
    expect(call().headers.has('Content-Type')).toBe(false);
  });
  it('updateFile PATCH snake_case', async () => {
    const { client, call } = setup(() => json(item));
    await client.updateFile('f1', { filename: 'b.pdf', folder_id: 'd2' });
    const { init, url } = call();
    expect(init.method).toBe('PATCH');
    expect(url).toMatch(/\/files\/f1$/);
    expect(JSON.parse(init.body as string)).toEqual({ filename: 'b.pdf', folder_id: 'd2' });
  });
  it('deleteFile DELETE tolerates 204', async () => {
    const { client, call } = setup(() => new Response(null, { status: 204 }));
    await expect(client.deleteFile('f1')).resolves.toBeUndefined();
    expect(call().init.method).toBe('DELETE');
  });
  it('url builders', () => {
    const { client } = setup(() => json({}), { baseUrl: '/api/shelf/' });
    expect(client.thumbnailUrl('f1')).toBe('/api/shelf/files/f1/thumbnail');
    expect(client.thumbnailUrl('f1', 'small')).toBe('/api/shelf/files/f1/thumbnail?size=small');
    expect(client.originalUrl('f1', 'my file.pdf')).toBe('/api/shelf/files/f1/original/my%20file.pdf');
  });
});

describe('baseUrl prefix and auth', () => {
  it('works with a relative prefix', async () => {
    const { client, call } = setup(() => json({ files: [] }), { baseUrl: '/api/shelf' });
    await client.listFiles();
    expect(call().url).toBe('/api/shelf/files');
  });
  it('no Authorization without apiKey, same-origin credentials', async () => {
    const { client, call } = setup(() => json({}));
    await client.info();
    expect(call().headers.has('Authorization')).toBe(false);
    expect(call().init.credentials).toBe('same-origin');
  });
  it('Bearer with apiKey', async () => {
    const { client, call } = setup(() => json({}), { apiKey: 'k123' });
    await client.info();
    expect(call().headers.get('Authorization')).toBe('Bearer k123');
  });
});

describe('errors', () => {
  it.each([
    [503, 'not_configured'],
    [401, 'unauthorized'],
    [413, 'too_large'],
    [415, 'unsupported_type'],
  ])('maps %i %s', async (status, code) => {
    const { client } = setup(() => json({ error: 'e', code, message: 'boom', field: 'file' }, status));
    const err = await client.getFile('f1').catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).toBe('boom');
    expect(err.field).toBe('file');
  });
  it('handles non-JSON error bodies', async () => {
    const { client } = setup(() => new Response('bad gateway', { status: 502 }));
    const err = await client.info().catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(502);
  });
});

describe('paging', () => {
  it('follows next_cursor', async () => {
    const pages = [{ files: [item], next_cursor: 'c2' }, { files: [{ ...item, id: 'f2' }], next_cursor: null }];
    let i = 0;
    const fetchMock = vi.fn(async (_u: RequestInfo | URL) => json(pages[i++]));
    const client = createShelfClient({ baseUrl: '/api/shelf', fetch: fetchMock as unknown as typeof fetch });
    const all = [];
    let cursor: string | undefined;
    do {
      const page = await client.listFiles({ cursor });
      all.push(...page.items);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(all.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(String(fetchMock.mock.calls[1]![0] as unknown)).toContain('cursor=c2');
  });
});

describe('0.3 client additions', () => {
  it('exposes baseUrl without trailing slash', () => {
    const { client } = setup(() => json({}), { baseUrl: '/api/shelf///' });
    expect(client.baseUrl).toBe('/api/shelf');
  });

  it('passes the signal to fetch and rejects with AbortError when aborted', async () => {
    const fetchMock = vi.fn((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      }),
    );
    const client = createShelfClient({ baseUrl: '/api/shelf', fetch: fetchMock as unknown as typeof fetch });
    const calls: Array<(s: AbortSignal) => Promise<unknown>> = [
      (signal) => client.info({ signal }),
      (signal) => client.folders({ signal }),
      (signal) => client.listFiles({}, { signal }),
      (signal) => client.getFile('f1', { signal }),
    ];
    for (const call of calls) {
      const ac = new AbortController();
      const p = call(ac.signal);
      ac.abort();
      const err = (await p.catch((e) => e)) as Error;
      expect(err.name).toBe('AbortError');
      expect(isOfflineError(err)).toBe(false);
      expect(isAuthLost(err)).toBe(false);
      expect((fetchMock.mock.calls.at(-1)![1] as RequestInit).signal).toBe(ac.signal);
    }
  });

  it('an already-aborted signal rejects immediately', async () => {
    const fetchMock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return json({});
    });
    const client = createShelfClient({ baseUrl: '/x', fetch: fetchMock as unknown as typeof fetch });
    const err = await client.info({ signal: AbortSignal.abort() }).catch((e) => e);
    expect(err.name).toBe('AbortError');
  });

  it('thumbnail 200 returns bytes, type and etag, and sends no If-None-Match without an etag', async () => {
    const { client, call } = setup(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/webp', ETag: '"abc"' } }));
    const r = await client.thumbnail!('f1', 'small');
    expect(r.status).toBe(200);
    if (r.status !== 200) throw new Error('unreachable');
    expect([...new Uint8Array(r.bytes)]).toEqual([1, 2, 3]);
    expect(r.type).toBe('image/webp');
    expect(r.etag).toBe('"abc"');
    expect(call().url).toBe('https://x.test/api/v1/integration/files/f1/thumbnail?size=small');
    expect(call().headers.has('If-None-Match')).toBe(false);
  });

  it('thumbnail with etag sends If-None-Match and maps 304', async () => {
    const { client, call } = setup(() => new Response(null, { status: 304 }), { apiKey: 'k' });
    const r = await client.thumbnail!('f1', 'medium', { etag: '"abc"' });
    expect(r).toEqual({ status: 304 });
    expect(call().headers.get('If-None-Match')).toBe('"abc"');
    expect(call().headers.get('Authorization')).toBe('Bearer k');
  });

  it('thumbnail errors become ShelfError', async () => {
    const { client } = setup(() => json({ code: 'not_found', message: 'nope' }, 404));
    const err = (await client.thumbnail!('f1', 'small').catch((e) => e)) as ShelfError;
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(404);
  });

  it('isAuthLost: 401 and 503 not_configured only', () => {
    expect(isAuthLost(new ShelfError(401, 'unauthorized', 'x'))).toBe(true);
    expect(isAuthLost(new ShelfError(503, 'not_configured', 'x'))).toBe(true);
    expect(isAuthLost(new ShelfError(502, 'bad_gateway', 'x'))).toBe(false);
    expect(isAuthLost(new ShelfError(503, 'unavailable', 'x'))).toBe(false);
    expect(isAuthLost(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAuthLost(null)).toBe(false);
  });

  it('isOfflineError: network TypeError, 502, plain 503; never not_configured, 4xx or AbortError', () => {
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineError(new ShelfError(502, 'bad_gateway', 'x'))).toBe(true);
    expect(isOfflineError(new ShelfError(503, 'unavailable', 'x'))).toBe(true);
    expect(isOfflineError(new ShelfError(503, 'not_configured', 'x'))).toBe(false);
    expect(isOfflineError(new ShelfError(401, 'unauthorized', 'x'))).toBe(false);
    expect(isOfflineError(new ShelfError(404, 'not_found', 'x'))).toBe(false);
    expect(isOfflineError(new DOMException('a', 'AbortError'))).toBe(false);
  });
});
