import { isHttpUrl } from '@linkstash/core';

export const DEFAULT_APP_URL = 'http://localhost:5173';

export interface ExtensionConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** Where "Open Linkstash" points: the deployed PWA, or the web dev server. */
  appUrl: string;
}

type ConfigEnv = Pick<ImportMetaEnv, 'WXT_SUPABASE_URL' | 'WXT_SUPABASE_PUBLISHABLE_KEY' | 'WXT_APP_URL'>;

/** Reads the build-time settings from apps/extension/.env. `null` makes the popup show setup instructions. */
export function readConfig(env: ConfigEnv = import.meta.env): ExtensionConfig | null {
  const supabaseUrl = env.WXT_SUPABASE_URL?.trim() ?? '';
  const supabasePublishableKey = env.WXT_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!supabasePublishableKey || !isHttpUrl(supabaseUrl)) return null;
  const appUrl = env.WXT_APP_URL?.trim() ?? '';
  return { supabaseUrl, supabasePublishableKey, appUrl: isHttpUrl(appUrl) ? appUrl : DEFAULT_APP_URL };
}
