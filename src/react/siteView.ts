import type { ShelfSite } from '../types';

/**
 * What a document's Content tab shows, from the site as GET /files/{id}/site answers it. Ported from Shelf web's
 * lib/documentSite.ts (siteState) minus the parts that ask the API to build: the integration API only reads sites.
 *
 *   not read yet                         -> pending: the tab, a skeleton
 *   read failed (404, error)             -> hidden (the page falls back to Text)
 *   error_code not_configured            -> hidden
 *   building, no spec yet                -> building: "Building this page…", polled
 *   building with the last good spec     -> site, "Updating…", polled
 *   ready                                -> site (stale: with a note that it may be out of date)
 *   failed with the last good spec       -> site (the last good one)
 *   none / ready or failed without spec  -> hidden
 */
export type SiteView =
  | { kind: 'hidden' }
  | { kind: 'pending' }
  | { kind: 'building' }
  | { kind: 'site'; spec: unknown; updating: boolean; outdated: boolean };

export function siteView(site: ShelfSite | undefined, readFailed: boolean): SiteView {
  if (!site) return readFailed ? { kind: 'hidden' } : { kind: 'pending' };
  if (site.error_code === 'not_configured') return { kind: 'hidden' };
  const hasSpec = site.spec !== undefined && site.spec !== null;
  switch (site.status) {
    case 'building':
      return hasSpec ? { kind: 'site', spec: site.spec, updating: true, outdated: false } : { kind: 'building' };
    case 'ready':
      return hasSpec ? { kind: 'site', spec: site.spec, updating: false, outdated: site.stale === true } : { kind: 'hidden' };
    case 'failed':
      return hasSpec ? { kind: 'site', spec: site.spec, updating: false, outdated: false } : { kind: 'hidden' };
    default:
      return { kind: 'hidden' };
  }
}
