import { describe, expect, it } from 'vitest';
import { readConfig } from './env';

describe('readConfig', () => {
  it('returns the trimmed Supabase config, or null when it is missing or invalid', () => {
    expect(readConfig({ VITE_SUPABASE_URL: ' https://abc.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: ' key ' })).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabasePublishableKey: 'key',
    });
    expect(readConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
    expect(readConfig({ VITE_SUPABASE_URL: 'abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' })).toBeNull();
    expect(readConfig({})).toBeNull();
  });
});
