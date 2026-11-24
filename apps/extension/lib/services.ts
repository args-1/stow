import {
  createLinkstashClient,
  fetchMetadata,
  isAuthRetryableFetchError,
  RemoteError,
  SupabaseRemote,
  type SupabaseClient,
} from '@linkstash/core';
import { readConfig, type ExtensionConfig } from './config';
import type { MenuServices } from './context-menu';
import { extensionAuthStorage } from './storage';

export interface Services extends MenuServices {
  config: ExtensionConfig;
  supabase: SupabaseClient;
  server: SupabaseRemote;
}

let services: Services | null | undefined;

/** Builds the Supabase client once per popup or worker. `null` means this build has no Supabase settings. */
export function getServices(): Services | null {
  if (services === undefined) {
    const config = readConfig();
    if (!config) {
      services = null;
    } else {
      const supabase = createLinkstashClient(config.supabaseUrl, config.supabasePublishableKey, extensionAuthStorage);
      services = {
        config,
        supabase,
        server: new SupabaseRemote(supabase),
        fetchMetadata: (url) => fetchMetadata(supabase, url),
        // getSession() refreshes an expired token. If that fails for lack of a network, report "offline", not "signed out".
        async hasSession() {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw isAuthRetryableFetchError(error) ? new RemoteError(`session: ${error.message}`, 0) : error;
          return data.session !== null;
        },
      };
    }
  }
  return services;
}
