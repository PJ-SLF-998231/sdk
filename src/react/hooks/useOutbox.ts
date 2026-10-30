import { useCallback, useMemo } from 'react';
import type { UseOutboxFn } from '../contracts';
import { useOutbox as useOutboxView } from '../../hooks/useOutbox';
import { useSessionOutbox } from '../provider/useSessionOutbox';
import { useShelfSessionState } from '../useShelfSession';

/** The offline outbox of a read_write key (empty and `ready: false` until its lazy chunk has loaded, or for a read key). */
export const useOutbox: UseOutboxFn = (source) => {
  const s = useShelfSessionState(source, true);
  const { outbox } = useSessionOutbox(s);
  const view = useOutboxView(outbox);
  const retry = useCallback(
    async (id: string) => {
      const entry = outbox?.list().find((e) => e.id === id);
      await outbox?.retry(id, entry?.status === 'conflict' ? { force: true } : undefined);
    },
    [outbox],
  );
  const discard = useCallback(async (id: string) => void (await outbox?.discard(id)), [outbox]);
  return useMemo(() => ({ ...view, ready: !!outbox, retry, discard }), [view, outbox, retry, discard]);
};
