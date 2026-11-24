import { useEffect, useState } from 'react';
import type { DexieLocalStore } from '../db';
import { toast } from '../toast';
import type { SyncScheduler } from './scheduler';

export interface SyncLifecycleDeps {
  scheduler: SyncScheduler;
  store: Pick<DexieLocalStore, 'ensureOwner'>;
  /** Listens for server-side changes to this user's rows and returns the unsubscribe function. */
  subscribeChanges(userId: string, onChange: () => void): () => void;
}

export const OPEN_FAILED_MESSAGE = 'Could not open the saved links on this device. Try reloading the page.';

const discardedMessage = (count: number) =>
  count === 1
    ? '1 unsynced change from the previous account was discarded.'
    : `${count} unsynced changes from the previous account were discarded.`;

/**
 * Keeps the signed-in user's data syncing while the app is open. Pass `null` when signed out.
 * Returns an error message when this device's saved links could not be opened for the user.
 */
export function useSyncLifecycle(deps: SyncLifecycleDeps, userId: string | null): string | null {
  const { scheduler, store, subscribeChanges } = deps;
  const [failure, setFailure] = useState<{ userId: string; message: string } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const request = () => scheduler.request();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') request();
    };

    store.ensureOwner(userId).then(
      ({ discarded }) => {
        // Reported even when this effect was cleaned up: the wipe has already happened.
        if (discarded > 0) toast.info(discardedMessage(discarded));
        if (!cancelled) scheduler.start();
      },
      () => {
        if (!cancelled) setFailure({ userId, message: OPEN_FAILED_MESSAGE });
      },
    );
    window.addEventListener('focus', request);
    window.addEventListener('online', request);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const unsubscribe = subscribeChanges(userId, request);

    return () => {
      cancelled = true;
      scheduler.stop();
      window.removeEventListener('focus', request);
      window.removeEventListener('online', request);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
    };
  }, [scheduler, store, subscribeChanges, userId]);

  return failure && failure.userId === userId ? failure.message : null;
}