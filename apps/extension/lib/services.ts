import { createLinkstashClient, fetchMetadata, SupabaseRemote, type SupabaseClient } from '@linkstash/core';
import { readConfig, type ExtensionConfig } from './config';
import type { MenuServices } from './context-menu';
import { hasSession } from './session';
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
      // No background refresh ticker: its storage read every 30 s would keep the MV3 service worker from ever going
      // idle. supabase-js and hasSession()'s getSession() refresh an expired token on demand.
      const supabase = createLinkstashClient(config.supabaseUrl, config.supabasePublishableKey, extensionAuthStorage, {
        autoRefreshToken: false,
      });
      services = {
        config,
        supabase,
        server: new SupabaseRemote(supabase),
        fetchMetadata: (url) => fetchMetadata(supabase, url),
        hasSession: () => hasSession(supabase.auth),
      };
    }
  }
  return services;
}
