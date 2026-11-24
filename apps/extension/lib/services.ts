import { createLinkstashClient, fetchMetadata, SupabaseRemote, type SupabaseClient } from '@linkstash/core';
import { readConfig, type ExtensionConfig } from './config';
import type { SaveDeps } from './save';
import { extensionAuthStorage } from './storage';

export interface Services extends SaveDeps {
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
      };
    }
  }
  return services;
}
