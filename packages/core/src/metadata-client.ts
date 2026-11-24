import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageMetadataInput } from './model';

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Asks the fetch-metadata Edge Function for a page's title, description and favicon.
 * Returns null on any failure (function not deployed, signed out, offline). Saving never waits on this.
 */
export async function fetchMetadata(client: SupabaseClient, url: string): Promise<PageMetadataInput | null> {
  try {
    const { data, error } = await client.functions.invoke('fetch-metadata', { body: { url } });
    if (error || typeof data !== 'object' || data === null) return null;
    const meta = data as Record<string, unknown>;
    return { title: text(meta.title), description: text(meta.description), faviconUrl: text(meta.faviconUrl) };
  } catch {
    return null;
  }
}
