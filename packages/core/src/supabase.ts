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

// Not named `storage`: the extension build (WXT) adds an import for any bare identifier that shares a name with one of its APIs.
export function createLinkstashClient(
  url: string,
  publishableKey: string,
  authStorage?: AuthStorage,
  options: {
    /** Off for short-lived extension contexts: requests and getSession() still refresh an expired token on demand. */
    autoRefreshToken?: boolean;
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
  });
}
