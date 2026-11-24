import { useEffect } from 'react';
import type { DexieLocalStore } from '../db';
import { toast } from '../toast';
import type { SyncScheduler } from './scheduler';

export interface SyncLifecycleDeps {
  scheduler: SyncScheduler;
  store: Pick<DexieLocalStore, 'ensureOwner'>;
  /** Listens for server-side changes to this user's rows and returns the unsubscribe function. */
  subscribeChanges(userId: string, onChange: () => void): () => void;
}

/** Keeps the signed-in user's data syncing while the app is open. Pass `null` when signed out. */
export function useSyncLifecycle(deps: SyncLifecycleDeps, userId: string | null): void {
  const { scheduler, store, subscribeChanges } = deps;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const request = () => scheduler.request();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') request();
    };

    store.ensureOwner(userId).then(
      () => {
        if (!cancelled) scheduler.start();
      },
      () => toast.error('Could not open the saved links on this device. Try reloading the page.'),
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
}
