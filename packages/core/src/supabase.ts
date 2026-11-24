import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type { Session, SupabaseClient, User } from '@supabase/supabase-js';
/** True when an auth call failed because the server could not be reached, so the session may still be valid. */
export { isAuthRetryableFetchError } from '@supabase/supabase-js';

/** Where supabase-js keeps the session: localStorage on the web, browser.storage.local in the extension. */
export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** How long one Supabase HTTP request may take before it is aborted. fetch has no timeout of its own. */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Wraps fetch so a request is aborted with a `TimeoutError` after `timeoutMs`, while still honouring the
 * caller's own signal.
 */
export function timeoutFetch(
  timeoutMs: number,
  baseFetch: typeof fetch = (input, init) => fetch(input, init),
): typeof fetch {
  return async (input, init) => {
    const callerSignal =
      init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);

    if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
      const timeout = AbortSignal.timeout(timeoutMs);
      return baseFetch(input, { ...init, signal: callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout });
    }

    // AbortSignal.any needs Safari 17.4+, so older iOS combines the signals by hand.
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    const timer = setTimeout(
      () => controller.abort(new DOMException('The request timed out.', 'TimeoutError')),
      timeoutMs,
    );
    if (callerSignal?.aborted) forwardAbort();
    else callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
  };
}

// Not named `storage`: the extension build (WXT) adds an import for any bare identifier that shares a name with one of its APIs.
export function createLinkstashClient(
  url: string,
  publishableKey: string,
  authStorage?: AuthStorage,
  options: {
    /** Off for short-lived extension contexts: requests and getSession() still refresh an expired token on demand. */
    autoRefreshToken?: boolean;
    /** Per-request HTTP timeout. Realtime's websocket is not affected. */
    fetchTimeoutMs?: number;
  } = {},
): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: options.autoRefreshToken ?? true,
      // Email + password only, so there are never tokens in the URL to pick up.
      detectSessionInUrl: false,
      ...(authStorage ? { storage: authStorage } : {}),
    },
    global: { fetch: timeoutFetch(options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS) },
  });
}