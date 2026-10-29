import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
const snapshot = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Whether the browser says it is online (`navigator.onLine`, kept current by the online/offline events). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
