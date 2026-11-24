import { CloudOff, RefreshCw } from 'lucide-react';

export interface StatusBadgeProps {
  online: boolean;
  /** Local changes not yet on the server. */
  pending: number;
}

export function StatusBadge({ online, pending }: StatusBadgeProps) {
  if (online && pending === 0) return null;
  const parts = [!online && 'Offline', pending > 0 && `${pending} pending`].filter(Boolean);
  const Icon = online ? RefreshCw : CloudOff;
  return (
    <span
      title={online ? 'Changes waiting to sync' : 'Offline. Changes sync when you reconnect.'}
      className={
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium ' +
        'text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      }
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {parts.join(' · ')}
    </span>
  );
}
