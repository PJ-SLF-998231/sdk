// @vitest-environment jsdom
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShelfError } from '../../src/client';
import { useFolders } from '../../src/react/hooks/useFolders';
import { useShelf } from '../../src/react/hooks/useShelf';
import { ShelfProvider } from '../../src/react/ShelfProvider';
import { clientForBaseUrl, disposeAllSessions, getSession, sessionCount } from '../../src/react/session';
import { namespaceFor, openKv } from '../../src/storage/db';
import { BASE, FOLDERS, freshDb, mock } from './helpers';

beforeEach(() => freshDb());
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Rows in the raw IndexedDB `entries` + `blobs` stores, whatever the namespace. */
async function storedRows(): Promise<number> {
  if (!(await indexedDB.databases()).some((d) => d.name === 'shelf-sdk')) return 0;
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('shelf-sdk');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  let n = 0;
  for (const store of ['entries', 'blobs']) {
    if (!db.objectStoreNames.contains(store)) continue;
    n += await new Promise<number>((res, rej) => {
      const r = db.transaction(store).objectStore(store).count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  db.close();
  return n;
}

const stored = async (scope: string, base = BASE): Promise<number> => {
  const kv = await openKv(await namespaceFor({ baseUrl: base, cacheScope: scope }));
  return (await kv.list('entries')).length;
};

function Names({ log }: { log?: number[] }) {
  const f = useFolders();
  log?.push(f.folders.length);
  return <p data-testid="names">{f.folders.map((x) => x.name).join(',')}</p>;
}

describe('one GET per baseUrl', () => {
  it('two useFolders consumers on the same baseUrl (no cacheScope) make exactly one GET /folders', async () => {
    const base = 'https://dedupe.test/api';
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.endsWith('/folders') ? FOLDERS : { access: 'read' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    function Two() {
      const a = useFolders({ baseUrl: base });
      const b = useFolders({ baseUrl: base });
      return <p data-testid="n">{a.folders.length + b.folders.length}</p>;
    }
    render(<><Two /><Two /></>);
    await waitFor(() => expect(screen.getAllByTestId('n')[0]!.textContent).toBe('4'));
    const gets = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/folders'));
    expect(gets).toHaveLength(1);
  });

  it('clientForBaseUrl returns one client per base URL', () => {
    expect(clientForBaseUrl('https://m.test/a')).toBe(clientForBaseUrl('https://m.test/a'));
    expect(clientForBaseUrl('https://m.test/a')).not.toBe(clientForBaseUrl('https://m.test/b'));
  });

  it('a provider baseUrl and a hook baseUrl on the same URL share it too', async () => {
    const base = 'https://dedupe2.test/api';
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/folders') ? FOLDERS : { access: 'read' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ShelfProvider baseUrl={base}>
        <Names />
      </ShelfProvider>,
    );
    function Own() {
      return <p data-testid="own">{useFolders({ baseUrl: base }).folders.length}</p>;
    }
    render(<Own />);
    await screen.findByText('Aisle CMS,Contracts');
    await waitFor(() => expect(screen.getByTestId('own').textContent).toBe('2'));
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/folders'))).toHaveLength(1);
  });
});

describe('cacheScope', () => {
  it('a consumer that remounts inside the provider shows the data on its first render', async () => {
    const client = mock();
    const log: number[] = [];
    function App() {
      const [on, setOn] = useState(true);
      return (
        <ShelfProvider client={client} cacheScope="user-1">
          <button onClick={() => setOn(!on)}>toggle</button>
          {on && <Names log={log} />}
        </ShelfProvider>
      );
    }
    render(<App />);
    await screen.findByText('Aisle CMS,Contracts');
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.queryByTestId('names')).toBeNull();
    log.length = 0;
    fireEvent.click(screen.getByText('toggle'));
    expect(log[0]).toBe(2); // first render of the remount
    expect(screen.getByTestId('names').textContent).toBe('Aisle CMS,Contracts');
  });

  it('after a page reload the persisted data shows before the network answers', async () => {
    const warm = mock();
    const first = render(
      <ShelfProvider client={warm} cacheScope="user-1">
        <Names />
      </ShelfProvider>,
    );
    await screen.findByText('Aisle CMS,Contracts');
    await waitFor(async () => expect(await stored('user-1')).toBeGreaterThanOrEqual(2));
    first.unmount();
    disposeAllSessions();
    const slow = mock({ folders: vi.fn(() => new Promise(() => undefined)) });
    render(
      <ShelfProvider client={slow} cacheScope="user-1">
        <Names />
      </ShelfProvider>,
    );
    await screen.findByText('Aisle CMS,Contracts');
    expect(slow.folders).toHaveBeenCalled();
  });

  it('without a cacheScope nothing is persisted', async () => {
    render(
      <ShelfProvider client={mock()}>
        <Names />
      </ShelfProvider>,
    );
    await screen.findByText('Aisle CMS,Contracts');
    await new Promise((r) => setTimeout(r, 50));
    expect(await storedRows()).toBe(0);
  });
});

describe('lost and offline', () => {
  it('a 401 calls onAuthLost once, however many consumers, and leaves the stores empty', async () => {
    const warm = mock();
    const w = render(
      <ShelfProvider client={warm} cacheScope="user-1">
        <Names />
      </ShelfProvider>,
    );
    await screen.findByText('Aisle CMS,Contracts');
    await waitFor(async () => expect(await stored('user-1')).toBeGreaterThanOrEqual(2));
    w.unmount();
    disposeAllSessions();

    const err = new ShelfError(401, 'unauthorized', 'bad key');
    const dead = mock({ info: vi.fn(async () => { throw err; }), folders: vi.fn(async () => { throw err; }) });
    const onAuthLost = vi.fn();
    function Probe() {
      const s = useShelf();
      return <p data-testid="status">{s.status}</p>;
    }
    render(
      <ShelfProvider client={dead} cacheScope="user-1" onAuthLost={onAuthLost}>
        <Names />
        <Names />
        <Probe />
      </ShelfProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('auth-lost'));
    await waitFor(() => expect(onAuthLost).toHaveBeenCalledTimes(1));
    expect(onAuthLost.mock.calls[0]![0]).toBe(err);
    await waitFor(async () => expect(await stored('user-1')).toBe(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(await stored('user-1')).toBe(0);
    expect(screen.getAllByTestId('names').map((n) => n.textContent)).toEqual(['', '']);
  });

  it('a hook-level onAuthLost and the provider one each hear it once', async () => {
    const err = new ShelfError(503, 'not_configured', 'revoked');
    const dead = mock({ info: vi.fn(async () => { throw err; }), folders: vi.fn(async () => { throw err; }) });
    const provided = vi.fn();
    const own = vi.fn();
    function Own() {
      useFolders({ onAuthLost: own });
      return null;
    }
    render(
      <ShelfProvider client={dead} onAuthLost={provided}>
        <Own />
        <Own />
      </ShelfProvider>,
    );
    await waitFor(() => expect(provided).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(own).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(provided).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('a TypeError on a refresh keeps the cached data and reports offline', async () => {
    let fail = false;
    const client = mock({
      folders: vi.fn(async () => {
        if (fail) throw new TypeError('Failed to fetch');
        return FOLDERS;
      }),
    });
    function View() {
      const f = useFolders();
      return (
        <>
          <p data-testid="n">{f.folders.length}</p>
          <p data-testid="off">{String(f.offline)}</p>
          <button onClick={() => void f.refresh()}>refresh</button>
        </>
      );
    }
    render(
      <ShelfProvider client={client} cacheScope="user-1">
        <View />
      </ShelfProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('2'));
    expect(screen.getByTestId('off').textContent).toBe('false');
    await new Promise((r) => setTimeout(r, 20)); // let the first revalidation settle: a refresh during one joins it
    fail = true;
    await act(async () => {
      fireEvent.click(screen.getByText('refresh'));
    });
    await waitFor(() => expect(screen.getByTestId('off').textContent).toBe('true'));
    expect(screen.getByTestId('n').textContent).toBe('2');
  });
});

describe('guarded client', () => {
  it('wraps every function-valued method except *Url, so methods added later report a lost session', async () => {
    const err = new ShelfError(401, 'unauthorized', 'x');
    const createFolder = vi.fn(async () => { throw err; });
    const raw = { ...mock(), createFolder } as unknown as ReturnType<typeof mock>;
    const session = getSession(raw, undefined);
    const lost = vi.fn();
    session.onAuthLost(lost);
    await expect((session.client as unknown as { createFolder(): Promise<void> }).createFolder()).rejects.toBe(err);
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    expect(session.client.thumbnailUrl).toBe(raw.thumbnailUrl); // *Url builders pass through
    expect(session.client.baseUrl).toBe(BASE);
  });
});

describe('server rendering', () => {
  it('makes no fetch, starts no timer and creates no session', () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = mock();
    function Page() {
      const f = useFolders();
      const s = useShelf();
      return <p>{f.loading ? 'loading' : 'loaded'} {s.status}</p>;
    }
    const html = renderToString(
      <ShelfProvider client={client} cacheScope="user-1">
        <Page />
        <Names />
      </ShelfProvider>,
    );
    expect(html).toContain('loading');
    expect(html).toContain('connecting');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.info).not.toHaveBeenCalled();
    expect(client.folders).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(sessionCount()).toBe(0);
  });

  it('with no source it renders disconnected', () => {
    function Probe() {
      return <p>{useShelf().status}</p>;
    }
    expect(renderToString(<Probe />)).toContain('disconnected');
  });
});
