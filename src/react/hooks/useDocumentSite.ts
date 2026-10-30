import { useEffect, useMemo } from 'react';
import { useResource } from '../../hooks/useResource';
import type { ShelfSite } from '../../types';
import type { UseDocumentSiteFn } from '../contracts';
import { mergeSame } from '../provider/merge';
import { useDocumentResource } from '../provider/useDocumentResource';
import { siteView } from '../siteView';
import type { SiteView } from '../siteView';

/** While the API builds the site, check back this often. */
export const SITE_POLL_MS = 2500;
const HIDDEN: SiteView = { kind: 'hidden' };
const PENDING: SiteView = { kind: 'pending' };

/**
 * The document's generated site. Never requests /site for a document without one: unless `enabled` is given, the
 * document itself (cache key `file:<id>`) is read first and `has_site === true` is required. Polls while building.
 */
export const useDocumentSite: UseDocumentSiteFn = (id, opts) => {
  const enabledOpt = opts?.enabled;
  const { s, res: docRes } = useDocumentResource(enabledOpt === undefined ? id : null, opts);
  const { swr, client } = s;
  const hasSite = enabledOpt === undefined ? docRes.data?.has_site === true : enabledOpt;
  const docKnown = enabledOpt !== undefined || docRes.data !== undefined || docRes.error !== undefined;
  const on = !!id && hasSite;
  const res = useResource<ShelfSite>(
    swr,
    useMemo(
      () => (swr && client && on && id ? { key: `site:${id}`, merge: mergeSame, fetcher: (signal: AbortSignal) => client.getSite(id, { signal }) } : null),
      [swr, client, on, id],
    ),
  );
  const building = on && res.data?.status === 'building';
  // `res` is a new object on every state change (an answer that equals the last one still changes `updatedAt`), so
  // every answer, failed or not, arms the next check; an unchanged site must not stop the polling.
  useEffect(() => {
    if (!building || res.loading) return;
    const t = setTimeout(() => void res.refresh(), SITE_POLL_MS);
    return () => clearTimeout(t);
  }, [building, res]);

  const view: SiteView = !id ? HIDDEN : on ? siteView(res.data, res.data === undefined && res.error !== undefined) : docKnown ? HIDDEN : PENDING;
  return { view, site: res.data, refresh: res.refresh };
};
