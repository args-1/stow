import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { fetchMetadata } from './metadata-client';
import { errorKind, RemoteError } from './remote';
import { SupabaseRemote } from './supabase-remote';
import { makeCategory, makeLink } from './testing';

interface Recorded {
  method: string;
  path: string;
  params: URLSearchParams;
  prefer: string | null;
  body: unknown;
}

type Reply = { status: number; body?: unknown } | Error;

/** A supabase-js client backed by a fake server that records requests and answers from a queue (default: 200 []). */
function fakeSupabase(...replies: Reply[]) {
  const requests: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = await req.text();
    requests.push({
      method: req.method,
      path: url.pathname,
      params: url.searchParams,
      prefer: req.headers.get('prefer'),
      body: text ? JSON.parse(text) : undefined,
    });
    const reply = replies.shift() ?? { status: 200, body: [] };
    if (reply instanceof Error) throw reply;
    const body = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const client = createClient('https://proj.supabase.co', 'sb_publishable_key', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, requests };
}

// Postgres returns microsecond timestamps. They must round-trip unchanged.
const T1 = '2026-01-01T00:00:01.000001+00:00';
const T2 = '2026-01-01T00:00:02.000002+00:00';

describe('SupabaseRemote pulls', () => {
  it('pulls all rows oldest first in one request when there is no cursor', async () => {
    const rows = [makeLink({ updated_at: T1 }), makeLink({ updated_at: T2 })];
    const { client, requests } = fakeSupabase({ status: 200, body: rows });

    expect(await new SupabaseRemote(client).pullLinks(null)).toEqual(rows);

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/rest/v1/links');
    expect(req.params.get('updated_at')).toBeNull();
    expect(req.params.get('order')).toBe('updated_at.asc,id.asc');
    expect(req.params.get('limit')).toBe('1000');
  });

  it('pages after the last (updated_at, id) so rows sharing a timestamp are not skipped', async () => {
    const a = makeCategory({ updated_at: T1 });
    const b = makeCategory({ updated_at: T2 });
    const c = makeCategory({ updated_at: T2 });
    const { client, requests } = fakeSupabase({ status: 200, body: [a, b] }, { status: 200, body: [c] });
    const since = '2026-01-01T00:00:00.000Z';

    expect(await new SupabaseRemote(client, { pageSize: 2 }).pullCategories(since)).toEqual([a, b, c]);

    expect(requests.map((r) => r.path)).toEqual(['/rest/v1/categories', '/rest/v1/categories']);
    expect(requests[0].params.get('updated_at')).toBe(`gt.${since}`);
    expect(requests[0].params.get('or')).toBeNull();
    expect(requests[0].params.get('limit')).toBe('2');
    expect(requests[1].params.get('updated_at')).toBe(`gt.${since}`);
    expect(requests[1].params.get('or')).toBe(`(updated_at.gt."${T2}",and(updated_at.eq."${T2}",id.gt."${b.id}"))`);
  });

  it('asks for one more page after a full page and stops on an empty one', async () => {
    const rows = [makeLink(), makeLink()];
    const { client, requests } = fakeSupabase({ status: 200, body: rows }, { status: 200, body: [] });

    expect(await new SupabaseRemote(client, { pageSize: 2 }).pullLinks(null)).toEqual(rows);
    expect(requests).toHaveLength(2);
  });
});

describe('SupabaseRemote writes', () => {
  it('upserts links on id without the columns the server owns', async () => {
    const link = makeLink({ user_id: 'user-1', visit_count: 7, last_visited_at: T1, updated_at: T2, tags: ['a'] });
    const { client, requests } = fakeSupabase({ status: 201 });

    await new SupabaseRemote(client).upsertLink(link);

    const [req] = requests;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/rest/v1/links');
    expect(req.params.get('on_conflict')).toBe('id');
    expect(req.prefer).toContain('resolution=merge-duplicates');
    const { user_id, visit_count, last_visited_at, updated_at, ...writable } = link;
    expect(req.body).toEqual(writable);
  });

  it('upserts categories on id without user_id and updated_at', async () => {
    const category = makeCategory({ user_id: 'user-1', updated_at: T2 });
    const { client, requests } = fakeSupabase({ status: 201 });

    await new SupabaseRemote(client).upsertCategory(category);

    const [req] = requests;
    expect(req.path).toBe('/rest/v1/categories');
    expect(req.params.get('on_conflict')).toBe('id');
    const { user_id, updated_at, ...writable } = category;
    expect(req.body).toEqual(writable);
  });

  it.each([
    [undefined, 'folder'],
    ['unicorn', 'unicorn'],
  ])('sends a category icon of %s as %s', async (icon, sent) => {
    const { client, requests } = fakeSupabase({ status: 201 });

    await new SupabaseRemote(client).upsertCategory(makeCategory({ icon }));

    const [req] = requests;
    expect(req.body).toMatchObject({ icon: sent });
  });

  it('records a visit through the increment_visit RPC', async () => {
    const { client, requests } = fakeSupabase({ status: 204 });

    await new SupabaseRemote(client).incrementVisit('link-1');

    expect(requests[0]).toMatchObject({ method: 'POST', path: '/rest/v1/rpc/increment_visit', body: { link_id: 'link-1' } });
  });
});

describe('SupabaseRemote errors', () => {
  it.each([
    [401, 'auth'],
    [403, 'fatal'],
    [409, 'fatal'],
    [429, 'retryable'],
    [503, 'retryable'],
  ] as const)('turns HTTP %i into a RemoteError the sync engine treats as %s', async (status, kind) => {
    const { client } = fakeSupabase({ status, body: { code: 'X', message: 'boom' } });

    const error = await new SupabaseRemote(client).upsertLink(makeLink()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).status).toBe(status);
    expect((error as RemoteError).message).toContain('boom');
    expect(errorKind(error)).toBe(kind);
  });

  it('reports a network failure as status 0, which is retryable', async () => {
    const { client } = fakeSupabase(new TypeError('fetch failed'));

    const error = await new SupabaseRemote(client).incrementVisit('link-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).status).toBe(0);
    expect(errorKind(error)).toBe('retryable');
  });
});

describe('SupabaseRemote lookups for the extension', () => {
  it('finds the newest live link with a url_key, or null', async () => {
    const link = makeLink();
    const { client, requests } = fakeSupabase({ status: 200, body: [link] }, { status: 200, body: [] });
    const remote = new SupabaseRemote(client);

    expect(await remote.findLinkByUrlKey(link.url_key)).toEqual(link);
    expect(await remote.findLinkByUrlKey('nothing.example')).toBeNull();

    const params = requests[0].params;
    expect(params.get('url_key')).toBe(`eq.${link.url_key}`);
    expect(params.get('deleted_at')).toBe('is.null');
    expect(params.get('order')).toBe('updated_at.desc');
    expect(params.get('limit')).toBe('1');
  });

  it('lists live categories by name', async () => {
    const categories = [makeCategory({ name: 'A' }), makeCategory({ name: 'B' })];
    const { client, requests } = fakeSupabase({ status: 200, body: categories });

    expect(await new SupabaseRemote(client).listCategories()).toEqual(categories);

    expect(requests[0].path).toBe('/rest/v1/categories');
    expect(requests[0].params.get('deleted_at')).toBe('is.null');
    expect(requests[0].params.get('order')).toBe('name.asc');
  });
});

describe('fetchMetadata', () => {
  it('posts the URL to the fetch-metadata function and keeps only string fields', async () => {
    const { client, requests } = fakeSupabase({
      status: 200,
      body: { title: 'Example', description: 42, faviconUrl: 'https://example.com/favicon.ico', extra: true },
    });

    expect(await fetchMetadata(client, 'https://example.com/')).toEqual({
      title: 'Example',
      description: null,
      faviconUrl: 'https://example.com/favicon.ico',
    });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/functions/v1/fetch-metadata',
      body: { url: 'https://example.com/' },
    });
  });

  it('returns null when the function rejects the request or cannot be reached', async () => {
    const { client } = fakeSupabase({ status: 401, body: { error: 'Unauthorized' } }, new TypeError('fetch failed'));

    expect(await fetchMetadata(client, 'https://example.com/')).toBeNull();
    expect(await fetchMetadata(client, 'https://example.com/')).toBeNull();
  });
});
