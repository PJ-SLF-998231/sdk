import { cx } from './cx';
import { plural } from './format';

/** Shown while the browser is offline or changes are waiting to be sent; says how many. Nothing otherwise. */
export function OfflineBanner({ online, waiting }: { online: boolean; waiting: number }) {
  if (online && waiting === 0) return null;
  const changes = plural(waiting, 'change');
  return (
    <p className={cx('callout', 'notice')} role="status" data-testid="shelf-outbox-banner">
      {online
        ? `Syncing ${changes}…`
        : waiting > 0
          ? `You're offline. ${changes} will be sent when you're back online.`
          : "You're offline. Changes you make will be sent when you're back online."}
    </p>
  );
}
