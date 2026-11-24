import { isHttpUrl } from '@linkstash/core';

export interface WebConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

type ConfigEnv = Pick<ImportMetaEnv, 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'>;

/** Reads the build-time Supabase settings. `null` makes the app show setup instructions instead. */
export function readConfig(env: ConfigEnv = import.meta.env): WebConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!supabasePublishableKey || !isHttpUrl(supabaseUrl)) return null;
  return { supabaseUrl, supabasePublishableKey };
}
