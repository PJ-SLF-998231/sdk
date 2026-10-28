import { describe, expect, it, vi } from 'vitest';
import { createShelfClient, ShelfError } from '../src';

const item = { id: 'f1', filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 3, folder_id: 'd1', parse_status: 'done', created_at: 't', edited_at: null, parsed_at: null, preview_sizes: [256] };

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
    const { client, call } = setup(() => json({ items: [item], next_cursor: null }));
    await client.listFiles({ folder_id: 'd1', limit: 10, cursor: 'c', recursive: true });
    const u = new URL(call().url);
    expect(u.pathname).toBe('/api/v1/integration/files');
    expect(Object.fromEntries(u.searchParams)).toEqual({ folder_id: 'd1', limit: '10', cursor: 'c', recursive: 'true' });
  });
  it('getFile', async () => {
    const { client, call } = setup(() => json(item));
    expect((await client.getFile('f1')).preview_sizes).toEqual([256]);
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
    expect(client.thumbnailUrl('f1', 256)).toBe('/api/shelf/files/f1/thumbnail?size=256');
    expect(client.originalUrl('f1', 'my file.pdf')).toBe('/api/shelf/files/f1/original/my%20file.pdf');
  });
});

describe('baseUrl prefix and auth', () => {
  it('works with a relative prefix', async () => {
    const { client, call } = setup(() => json({ items: [] }), { baseUrl: '/api/shelf' });
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
    const pages = [{ items: [item], next_cursor: 'c2' }, { items: [{ ...item, id: 'f2' }], next_cursor: null }];
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
