// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Thumb } from '../../src/react/Thumb';
import type { ThumbLoader } from '../../src/internal/contracts';

let observers: Array<{ cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; disconnect: () => void }> = [];
beforeEach(() => {
  observers = [];
  class IO {
    cb: IntersectionObserverCallback;
    opts?: IntersectionObserverInit;
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      this.cb = cb;
      this.opts = opts;
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal('IntersectionObserver', IO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function loaderMock(url: string | null = 'blob:x') {
  let signal: AbortSignal | undefined;
  const loader: ThumbLoader = {
    load: vi.fn(async (req) => {
      signal = req.signal;
      return url;
    }),
    peek: vi.fn(() => null),
    dispose: vi.fn(),
  };
  return { loader, signal: () => signal };
}
const props = { id: 'd1', available: ['small', 'medium'], alt: '', width: 400, height: 300 };

describe('Thumb', () => {
  it('loads only after the element intersects, once, with a 200px margin', async () => {
    const { loader } = loaderMock();
    const { container } = render(<Thumb loader={loader} {...props} fallback={<i>F</i>} />);
    expect(loader.load).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('F');
    expect(observers[0]!.opts?.rootMargin).toBe('200px');
    await act(async () => {
      observers[0]!.cb([{ isIntersecting: false } as IntersectionObserverEntry], observers[0] as never);
    });
    expect(loader.load).not.toHaveBeenCalled();
    await act(async () => {
      observers[0]!.cb([{ isIntersecting: true } as IntersectionObserverEntry], observers[0] as never);
    });
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(loader.load).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', size: 'medium' }));
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('blob:x');
    expect(img.getAttribute('width')).toBe('400');
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it('aborts the load on unmount', async () => {
    let resolve!: (u: string | null) => void;
    const loader: ThumbLoader = {
      load: vi.fn((req) => {
        sig = req.signal;
        return new Promise<string | null>((r) => { resolve = r; });
      }),
      peek: () => null,
      dispose: () => {},
    };
    let sig: AbortSignal | undefined;
    const { unmount } = render(<Thumb loader={loader} {...props} />);
    await act(async () => {
      observers[0]!.cb([{ isIntersecting: true } as IntersectionObserverEntry], observers[0] as never);
    });
    expect(sig?.aborted).toBe(false);
    unmount();
    expect(sig?.aborted).toBe(true);
    resolve('blob:late'); // a late answer after unmount must not throw
  });

  it('loads immediately without IntersectionObserver', async () => {
    vi.unstubAllGlobals();
    // @ts-expect-error jsdom has none; make sure
    delete globalThis.IntersectionObserver;
    const { loader } = loaderMock();
    await act(async () => {
      render(<Thumb loader={loader} {...props} />);
    });
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it('renders only the fallback and never loads when no size is available', async () => {
    const { loader } = loaderMock();
    const { container } = render(<Thumb loader={loader} {...props} available={[]} fallback={<i>F</i>} />);
    expect(container.innerHTML).toBe('<i>F</i>');
    expect(observers).toHaveLength(0);
    expect(loader.load).not.toHaveBeenCalled();
  });
});
