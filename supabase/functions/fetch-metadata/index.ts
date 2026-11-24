import { createHandler, edgeApiKey, supabaseAuthenticator } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const apiKey = edgeApiKey((name) => Deno.env.get(name));
if (!supabaseUrl || !apiKey) {
  throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEYS (or the legacy SUPABASE_ANON_KEY) must be set');
}

Deno.serve(createHandler({ authenticate: supabaseAuthenticator(supabaseUrl, apiKey, fetch), fetch }));
