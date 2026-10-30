import { useEffect, useMemo } from 'react';
import type { SwrImpl } from '../../cache/swr';
import type { ShelfClient } from '../../client';
import { useResource } from '../../hooks/useResource';
import type { ShelfSite } from '../../types';
import { mergeSame } from '../provider/merge';
import { siteView } from '../siteView';
import type { SiteView } from '../siteView';

/** While the API builds the site, check back this often. */
export const SITE_POLL_MS = 2500;

/**
 * The document's site (cache key `site:<id>`) and what the Content tab should show, polled while the API builds it.
 * `on` false: nothing is requested. Shared by useDocumentSite and the document page that is given the session's parts.
 */
export function useSiteView(swr: SwrImpl | null, client: ShelfClient | null, id: string | null, on: boolean) {
  const active = on && !!id;
  const res = useResource<ShelfSite>(
    swr,
    useMemo(
      () => (swr && client && active && id ? { key: `site:${id}`, merge: mergeSame, fetcher: (signal: AbortSignal) => client.getSite(id, { signal }) } : null),
      [swr, client, active, id],
    ),
  );
  const building = active && res.data?.status === 'building';
  // `res` is a new object on every state change (an answer that equals the last one still changes `updatedAt`), so
  // every answer, failed or not, arms the next check; an unchanged site must not stop the polling.
  useEffect(() => {
    if (!building || res.loading) return;
    const t = setTimeout(() => void res.refresh(), SITE_POLL_MS);
    return () => clearTimeout(t);
  }, [building, res]);
  const view: SiteView | null = active ? siteView(res.data, res.data === undefined && res.error !== undefined) : null;
  return { view, site: res.data, refresh: res.refresh };
}
