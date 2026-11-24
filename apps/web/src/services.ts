import {
  createStowClient,
  fetchMetadata,
  isAuthRetryableFetchError,
  SupabaseRemote,
  SyncEngine,
  type SupabaseClient,
} from '@stow/core';
import { createContext, use } from 'react';
import { createActions, type Actions } from './actions';
import { DexieLocalStore, openDb } from './db';
import type { WebConfig } from './env';
import { createSyncScheduler, type SyncScheduler } from './sync/scheduler';
import { withSyncLock } from './sync/syncLock';
import { errorText, toast } from './toast';

export interface Services {
  supabase: SupabaseClient;
  store: DexieLocalStore;
  engine: SyncEngine;
  scheduler: SyncScheduler;
  actions: Actions;
  subscribeChanges(userId: string, onChange: () => void): () => void;
}

export function createServices(config: WebConfig): Services {
  const supabase = createStowClient(config.supabaseUrl, config.supabasePublishableKey);
  const store = new DexieLocalStore(openDb());
  const engine = new SyncEngine(store, new SupabaseRemote(supabase), {
    onFatalError: (error) => toast.error(`A change could not be saved: ${errorText(error)}`),
  });

  const scheduler = createSyncScheduler({
    // Tabs share one IndexedDB outbox, so serialize syncs across tabs to avoid pushing the same entries twice.
    // stop() aborts `signal`, which also drops a request still queued behind another tab's lock.
    run: (signal) =>
      withSyncLock(() => engine.sync(signal), 'locks' in navigator ? navigator.locks : undefined, signal),
    async onAuth(attempt) {
      if (attempt === 0) {
        const { error } = await supabase.auth.refreshSession();
        if (!error) return true;
        if (isAuthRetryableFetchError(error)) return false;
      }
      toast.error('Your session expired. Sign in again to keep syncing.');
      await supabase.auth.signOut({ scope: 'local' });
      return false;
    },
    onRetry(failures) {
      if (failures === 3 && navigator.onLine) toast.error('Cannot reach the server. Your changes are saved here and will sync later.');
    },
    onError: (error) => toast.error(`Sync failed: ${errorText(error)}`),
  });

  let channelCount = 0;
  function subscribeChanges(userId: string, onChange: () => void): () => void {
    const filter = `user_id=eq.${userId}`;
    const channel = supabase
      .channel(`stow:${userId}:${++channelCount}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'links', filter }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter }, onChange)
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }

  const actions = createActions({
    engine,
    store,
    requestSync: () => scheduler.request(),
    fetchMetadata: (url) => fetchMetadata(supabase, url),
  });

  return { supabase, store, engine, scheduler, actions, subscribeChanges };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = use(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesContext>');
  return services;
}
