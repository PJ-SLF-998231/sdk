import type { SiteView } from '../siteView';
import type { UseDocumentSiteFn } from '../contracts';
import { useDocumentResource } from '../provider/useDocumentResource';
import { useSiteView } from '../document/useSiteView';

export { SITE_POLL_MS } from '../document/useSiteView';
const HIDDEN: SiteView = { kind: 'hidden' };
const PENDING: SiteView = { kind: 'pending' };

/**
 * The document's generated site. Never requests /site for a document without one: unless `enabled` is given, the
 * document itself (cache key `file:<id>`) is read first and `has_site === true` is required. Polls while building.
 */
export const useDocumentSite: UseDocumentSiteFn = (id, opts) => {
  const enabledOpt = opts?.enabled;
  const { s, res: docRes } = useDocumentResource(enabledOpt === undefined ? id : null, opts);
  const hasSite = enabledOpt === undefined ? docRes.data?.has_site === true : enabledOpt;
  const docKnown = enabledOpt !== undefined || docRes.data !== undefined || docRes.error !== undefined;
  const { view, site, refresh } = useSiteView(s.swr, s.client, id, hasSite);
  return { view: !id ? HIDDEN : (view ?? (docKnown ? HIDDEN : PENDING)), site, refresh };
};
