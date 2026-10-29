import { useEffect, useState } from 'react';
import type { Outbox, OutboxView } from '../internal/contracts';

const EMPTY: OutboxView = { entries: [], pending: 0, failed: 0, conflicts: 0, offline: false };

function viewOf(outbox: Outbox, offline: boolean): OutboxView {
  const entries = outbox.list();
  let pending = 0;
  let failed = 0;
  let conflicts = 0;
  for (const e of entries) {
    if (e.status === 'failed') failed++;
    else if (e.status === 'conflict') conflicts++;
    else pending++;
  }
  return { entries, pending, failed, conflicts, offline };
}

/** Subscribes to an outbox; null (no outbox yet) gives an empty view. */
export function useOutbox(outbox: Outbox | null): OutboxView {
  const [view, setView] = useState<OutboxView>(() => (outbox ? viewOf(outbox, !!(outbox as { offline?: boolean }).offline) : EMPTY));
  useEffect(() => {
    if (!outbox) {
      setView(EMPTY);
      return;
    }
    let offline = !!(outbox as { offline?: boolean }).offline;
    const refresh = () => setView(viewOf(outbox, offline));
    refresh();
    const offChange = outbox.on('change', refresh);
    const offOffline = outbox.on('offline', (v) => {
      offline = v;
      refresh();
    });
    return () => {
      offChange();
      offOffline();
    };
  }, [outbox]);
  return view;
}
