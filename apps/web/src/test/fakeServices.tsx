import { SyncEngine, type Session, type SupabaseClient } from '@linkstash/core';
import { FakeRemote } from '@linkstash/core/testing';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { createActions } from '../actions';
import { DexieLocalStore, openDb } from '../db';
import { ServicesContext, type Services } from '../services';

type AuthListener = (event: string, session: Session | null) => void;

export function fakeSession(userId: string): Session {
  return { access_token: `token-${userId}`, user: { id: userId, email: `${userId}@example.com` } } as unknown as Session;
}

/** The parts of `supabase.auth` the app uses. Signing in always signs in as user-1. */
export function createFakeAuth(initial: Session | null) {
  let session = initial;
  const listeners = new Set<AuthListener>();
  const emit = (event: string, next: Session | null) => {
    session = next;
    for (const listener of listeners) listener(event, next);
  };
  return {
    emit,
    onAuthStateChange: vi.fn((listener: AuthListener) => {
      listeners.add(listener);
      // Like supabase-js, report the stored session asynchronously.
      queueMicrotask(() => listener('INITIAL_SESSION', session));
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    }),
    signInWithPassword: vi.fn(async (_credentials: { email: string; password: string }) => {
      const next = fakeSession('user-1');
      emit('SIGNED_IN', next);
      return { data: { session: next, user: next.user }, error: null };
    }),
    signUp: vi.fn(async (_credentials: { email: string; password: string }) => ({
      data: { session: null, user: null },
      error: null,
    })),
    signOut: vi.fn(async (_options?: { scope?: string }) => {
      emit('SIGNED_OUT', null);
      return { error: null };
    }),
  };
}

export type FakeAuth = ReturnType<typeof createFakeAuth>;

let databases = 0;

export function createFakeServices(session: Session | null = null) {
  const auth = createFakeAuth(session);
  const store = new DexieLocalStore(openDb(`linkstash-test-${++databases}`));
  const engine = new SyncEngine(store, new FakeRemote());
  const scheduler = { start: vi.fn(), stop: vi.fn(), request: vi.fn() };
  const services: Services = {
    supabase: { auth } as unknown as SupabaseClient,
    store,
    engine,
    scheduler,
    actions: createActions({ engine, store, requestSync: scheduler.request, fetchMetadata: async () => null }),
    subscribeChanges: vi.fn(() => () => {}),
  };
  return { services, auth, store, scheduler };
}

export type FakeServices = ReturnType<typeof createFakeServices>;

export function renderWithServices(ui: ReactElement, services: Services) {
  return render(<ServicesContext value={services}>{ui}</ServicesContext>);
}
