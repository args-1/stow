import { isFetchableUrl, parseHtmlMetadata, type PageMetadata } from '../_shared/metadata.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HandlerDeps {
  /** Returns the user id for a valid access token, otherwise null. */
  authenticate(token: string): Promise<string | null>;
  fetch: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMPTY: PageMetadata = { title: null, description: null, faviconUrl: null };
const MAX_REDIRECTS = 5;
const HTML_TYPE = /^\s*(text\/html|application\/xhtml\+xml)/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** The key the function sends to Supabase Auth: the default publishable key, or the legacy anon key on older projects. */
export function edgeApiKey(env: (name: string) => string | undefined): string | null {
  try {
    const keys: unknown = JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') ?? 'null');
    if (keys && typeof keys === 'object' && 'default' in keys && typeof keys.default === 'string' && keys.default) {
      return keys.default;
    }
  } catch {
    // Malformed JSON: use the legacy key below.
  }
  return env('SUPABASE_ANON_KEY') || null;
}

/** Resolves an access token to a user id through Supabase Auth (the same call as auth.getUser(token)). */
export function supabaseAuthenticator(supabaseUrl: string, apiKey: string, fetch: FetchLike) {
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`;
  return async (token: string): Promise<string | null> => {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, apikey: apiKey } });
    if (!res.ok) return null;
    const user: unknown = await res.json();
    return user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? user.id : null;
  };
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const timeoutMs = deps.timeoutMs ?? 5000;
  const maxBytes = deps.maxBytes ?? 1_000_000;

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
    const userId = token ? await deps.authenticate(token).catch(() => null) : null;
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    const body: unknown = await req.json().catch(() => null);
    const url = body && typeof body === 'object' && 'url' in body ? body.url : undefined;
    if (typeof url !== 'string' || !isFetchableUrl(url)) return json({ error: 'Invalid url' }, 400);

    try {
      return json(await readPage(url, deps.fetch, timeoutMs, maxBytes));
    } catch {
      return json(EMPTY);
    }
  };
}

async function readPage(url: string, fetch: FetchLike, timeoutMs: number, maxBytes: number): Promise<PageMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; LinkstashBot/1.0)',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const location = res.headers.get('Location');
        const next = location ? new URL(location, current).href : null;
        if (!next || !isFetchableUrl(next)) return EMPTY;
        current = next;
        continue;
      }
      const type = res.headers.get('Content-Type') ?? '';
      if (!res.ok || !HTML_TYPE.test(type)) {
        await res.body?.cancel();
        return EMPTY;
      }
      return parseHtmlMetadata(await readText(res, type, maxBytes), current);
    }
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

async function readText(res: Response, contentType: string, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const buffer = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, maxBytes - length);
      buffer.set(value.subarray(0, take), length);
      length += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return decoderFor(contentType).decode(buffer.subarray(0, length));
}

function decoderFor(contentType: string): TextDecoder {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}
