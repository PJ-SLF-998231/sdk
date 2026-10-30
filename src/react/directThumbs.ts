import type { ShelfClient } from '../client';
import type { ThumbLoader } from '../internal/contracts';

/** A loader that has nothing to load with: every thumbnail falls back to its placeholder. */
export const noThumbs: ThumbLoader = { load: async () => null, peek: () => null, dispose: () => undefined };

/**
 * Uncached thumbnails straight from the client, for a component used with only `{client}` (no session, no cache engine).
 * Fetches with the client's credentials (client.thumbnail) into an object URL; a client without it gets the plain URL.
 */
export function createDirectThumbLoader(client: ShelfClient): ThumbLoader {
  const urls = new Map<string, string>();
  const latest = new Map<string, string>();
  return {
    peek: (id, size) => latest.get(`${id}|${size}`) ?? null,
    async load({ id, size, version, signal }) {
      const key = `${id}|${size}|${version ?? ''}`;
      const have = urls.get(key);
      if (have) return have;
      if (!client.thumbnail) return client.thumbnailUrl(id, size);
      try {
        const res = await client.thumbnail(id, size, { signal });
        if (res.status !== 200 || signal?.aborted) return null;
        const url = URL.createObjectURL(new Blob([res.bytes], { type: res.type }));
        urls.set(key, url);
        latest.set(`${id}|${size}`, url);
        return url;
      } catch {
        return null;
      }
    },
    dispose() {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
      latest.clear();
    },
  };
}
