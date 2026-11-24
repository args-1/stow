import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_URL, readConfig } from './config';

const supabase = { WXT_SUPABASE_URL: ' https://abc.supabase.co ', WXT_SUPABASE_PUBLISHABLE_KEY: ' key ' };

describe('readConfig', () => {
  it('returns the trimmed Supabase settings and the default app URL', () => {
    expect(readConfig(supabase)).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabasePublishableKey: 'key',
      appUrl: DEFAULT_APP_URL,
    });
  });

  it('uses WXT_APP_URL when it is a web URL', () => {
    expect(readConfig({ ...supabase, WXT_APP_URL: ' https://links.example.com ' })?.appUrl).toBe(
      'https://links.example.com',
    );
    expect(readConfig({ ...supabase, WXT_APP_URL: 'links.example.com' })?.appUrl).toBe(DEFAULT_APP_URL);
  });

  it('returns null when the Supabase settings are missing or invalid', () => {
    expect(readConfig({ WXT_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
    expect(readConfig({ WXT_SUPABASE_URL: 'abc.supabase.co', WXT_SUPABASE_PUBLISHABLE_KEY: 'key' })).toBeNull();
    expect(readConfig({})).toBeNull();
  });
});
