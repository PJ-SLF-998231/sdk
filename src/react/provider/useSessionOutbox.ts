import { useEffect, useState } from 'react';
import type { OutboxHandle } from '../../outbox';
import type { OutboxEntry } from '../../internal/contracts';
import type { ShelfSessionState } from '../useShelfSession';

export interface SessionOutbox {
  /** A read_write key's outbox, once its lazy chunk has loaded; null for a read key, `offline.outbox === false`, or before then. */
  outbox: OutboxHandle | null;
  entries: OutboxEntry[];
  /** The key may write and the outbox is there to take the change. */
  canWrite: boolean;
}

const NONE: OutboxEntry[] = [];

/** The session's outbox for a read_write key (loaded lazily, only here), started while mounted. Kept lean: useFolders pays for it. */
export function useSessionOutbox(s: ShelfSessionState): SessionOutbox {
  const wanted = s.access === 'read_write' && s.offline?.outbox !== false;
  const outbox = wanted && s.session && s.session.parts ? s.session.ensureOutbox(s.offline) : null;
  const [entries, setEntries] = useState<OutboxEntry[]>(NONE);
  useEffect(() => {
    if (!outbox) return setEntries(NONE);
    outbox.start();
    const sync = () => setEntries(outbox.list());
    sync();
    return outbox.on('change', sync);
  }, [outbox]);
  return { outbox, entries, canWrite: !!outbox };
}
