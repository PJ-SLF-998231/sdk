import { useOnline } from '../../hooks/useOnline';
import type { UseOnlineStatusFn } from '../contracts';

/** Whether the browser says it is online. Real (not a stub): the existing internal hook under its public name. */
export const useOnlineStatus: UseOnlineStatusFn = useOnline;
