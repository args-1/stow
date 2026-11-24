import { describe, expect, it, vi } from 'vitest';
import {
  createHandler,
  edgeApiKey,
  supabaseAuthenticator,
  type FetchLike,
  type HandlerDeps,
} from '../../../supabase/functions/fetch-metadata/handler.ts';

const EMPTY = { title: null, description: null, faviconUrl: null };
const PAGE =
  '<html><head><title>Hello</title><meta name="description" content="World"><link rel="icon" href="/i.png"></head></html>';

const html = (body: BodyInit = PAGE, type = 'text/html; charset=utf-8') =>
  new Response(body, { headers: { 'Content-Type': type } });

const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location } });

function post(body: unknown, token: string | null = 'good-token'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('https://fn.test/fetch-metadata', { method: 'POST', headers, body: JSON.stringify(body) });
}

/** Builds a handler whose fetch answers with the given responses, in order. */
function setup(responses: (Response | Error)[], options: Partial<HandlerDeps> = {}) {
  const fetch = vi.fn<FetchLike>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  const authenticate = vi.fn(async (token: string) => (token === 'good-token' ? 'user-1' : null));
  return { fetch, authenticate, handle: createHandler({ fetch, authenticate, ...options }) };
}

async function metadataFor(responses: (Response | Error)[], options: Partial<HandlerDeps> = {}) {
  const res = await setup(responses, options).handle(post({ url: 'https://a.io/page' }));
  expect(res.status).toBe(200);
  return res.json();
}

describe('fetch-metadata handler', () => {
  it('answers CORS preflight and rejects other methods', async () => {
    const { handle } = setup([]);
    const preflight = await handle(new Request('https://fn.test/', { method: 'OPTIONS' }));
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect((await handle(new Request('https://fn.test/'))).status).toBe(405);
  });

  it('requires a valid user token before fetching anything', async () => {
    const { handle, fetch, authenticate } = setup([]);
    expect((await handle(post({ url: 'https://a.io/' }, null))).status).toBe(401);
    expect((await handle(post({ url: 'https://a.io/' }, 'bad-token'))).status).toBe(401);
    expect(authenticate).toHaveBeenCalledWith('bad-token');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing, non-http, and private URLs without fetching', async () => {
    const { handle, fetch } = setup([]);
    for (const url of [undefined, 42, 'file:///etc/passwd', 'http://127.0.0.1/admin', 'http://10.0.0.1/']) {
      const res = await handle(post({ url }));
      expect(res.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns parsed metadata with CORS headers', async () => {
    const { handle, fetch } = setup([html()]);
    const res = await handle(post({ url: 'https://a.io/page' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ title: 'Hello', description: 'World', faviconUrl: 'https://a.io/i.png' });
    expect(fetch).toHaveBeenCalledWith('https://a.io/page', expect.objectContaining({ redirect: 'manual' }));
  });

  it('follows public redirects and resolves relative URLs against the final page', async () => {
    expect(await metadataFor([redirect('https://b.io/x'), html()])).toMatchObject({ faviconUrl: 'https://b.io/i.png' });
  });

  it('refuses redirects to private hosts and gives up after 5 redirects', async () => {
    const internal = setup([redirect('http://169.254.169.254/latest/meta-data')]);
    expect(await (await internal.handle(post({ url: 'https://a.io/' }))).json()).toEqual(EMPTY);
    expect(internal.fetch).toHaveBeenCalledTimes(1);

    const loop = setup(Array.from({ length: 6 }, (_, i) => redirect(`https://a.io/${i}`)));
    expect(await (await loop.handle(post({ url: 'https://a.io/' }))).json()).toEqual(EMPTY);
    expect(loop.fetch).toHaveBeenCalledTimes(6);
  });

  it('returns empty metadata for non-HTML responses, HTTP errors, and network errors', async () => {
    expect(await metadataFor([html('{}', 'application/json')])).toEqual(EMPTY);
    expect(await metadataFor([new Response('nope', { status: 404, headers: { 'Content-Type': 'text/html' } })])).toEqual(EMPTY);
    expect(await metadataFor([new Error('ECONNRESET')])).toEqual(EMPTY);
  });

  it('times out slow pages', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const handle = createHandler({ fetch: hang, authenticate: async () => 'user-1', timeoutMs: 20 });
    expect(await (await handle(post({ url: 'https://a.io/' }))).json()).toEqual(EMPTY);
  });

  it('stops reading the body after maxBytes', async () => {
    let chunks = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new TextEncoder().encode('<head><title>Big</title>'.padEnd(1000, ' ')));
      },
    });
    expect(await metadataFor([html(endless)], { maxBytes: 4096 })).toMatchObject({ title: 'Big' });
    expect(chunks).toBeLessThan(10);
  });
});

describe('supabaseAuthenticator', () => {
  it('asks Supabase Auth who owns the token', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ id: 'user-1' })));
    const authenticate = supabaseAuthenticator('https://p.supabase.co/', 'sb_publishable_key', fetch);
    expect(await authenticate('tok')).toBe('user-1');
    expect(fetch).toHaveBeenCalledWith('https://p.supabase.co/auth/v1/user', {
      headers: { Authorization: 'Bearer tok', apikey: 'sb_publishable_key' },
    });
    fetch.mockResolvedValueOnce(new Response('{"message":"invalid JWT"}', { status: 401 }));
    expect(await authenticate('expired')).toBeNull();
  });
});

describe('edgeApiKey', () => {
  const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

  it('prefers the default publishable key', () => {
    const env = envOf({
      SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_abc","mobile":"sb_publishable_xyz"}',
      SUPABASE_ANON_KEY: 'legacy-jwt',
    });
    expect(edgeApiKey(env)).toBe('sb_publishable_abc');
  });

  it('falls back to the legacy anon key when there is no usable publishable key', () => {
    expect(edgeApiKey(envOf({ SUPABASE_ANON_KEY: 'legacy-jwt' }))).toBe('legacy-jwt');
    expect(edgeApiKey(envOf({ SUPABASE_PUBLISHABLE_KEYS: 'not json', SUPABASE_ANON_KEY: 'legacy-jwt' }))).toBe('legacy-jwt');
    expect(edgeApiKey(envOf({ SUPABASE_PUBLISHABLE_KEYS: '{"mobile":"x"}', SUPABASE_ANON_KEY: 'legacy-jwt' }))).toBe('legacy-jwt');
  });

  it('returns null when neither key is set', () => {
    expect(edgeApiKey(envOf({}))).toBeNull();
  });
});
