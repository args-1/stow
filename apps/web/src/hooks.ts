import type { Category, Link, Session, SupabaseClient } from '@stow/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DexieLocalStore } from './db';

/** Every link row on this device, including archived and deleted ones. `undefined` while loading. */
export function useLinks(store: DexieLocalStore): Link[] | undefined {
  return useLiveQuery(() => store.db.links.toArray(), [store]);
}

/** Every category row on this device, including deleted ones. `undefined` while loading. */
export function useCategories(store: DexieLocalStore): Category[] | undefined {
  return useLiveQuery(() => store.db.categories.toArray(), [store]);
}

/** Number of local changes that have not reached the server yet. */
export function usePendingCount(store: DexieLocalStore): number {
  return useLiveQuery(() => store.db.outbox.count(), [store], 0);
}

/** The user whose data is on this device: `undefined` while loading, `null` when there is none. */
export function useOwner(store: DexieLocalStore): string | null | undefined {
  return useLiveQuery(() => store.getOwner(), [store]);
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

export type SessionState = { status: 'loading' } | { status: 'ready'; session: Session | null };

export function useSession(supabase: SupabaseClient): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ status: 'ready', session }));
    return () => data.subscription.unsubscribe();
  }, [supabase]);
  return state;
}
