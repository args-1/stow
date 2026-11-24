import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchMetadata } from './metadata-client';
import { createCategory, createLink, parseLinkInput, updateCategory, updateLink } from './model';
import { CATEGORY_COLORS, type Category, type Link } from './schema';
import { createStowClient, type AuthStorage } from './supabase';
import { SupabaseRemote } from './supabase-remote';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Put VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in apps/web/.env, ` +
        'and SMOKE_EMAIL and SMOKE_PASSWORD in apps/web/.env.local.',
    );
  }
  return value;
}

function memoryStorage(): AuthStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const url = requireEnv('VITE_SUPABASE_URL');
const publishableKey = requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
const email = requireEnv('SMOKE_EMAIL');
const password = requireEnv('SMOKE_PASSWORD');

const client = createStowClient(url, publishableKey, memoryStorage());
const remote = new SupabaseRemote(client);
const createdLinks: string[] = [];
const createdCategories: string[] = [];

async function saveCategory(name: string): Promise<Category> {
  const category = createCategory({ name: `${name} ${Date.now()}`, color: CATEGORY_COLORS[0] });
  createdCategories.push(category.id);
  await remote.upsertCategory(category);
  return category;
}

async function saveLink(categoryId: string): Promise<Link> {
  const parsed = parseLinkInput({
    url: `https://example.com/stow-smoke/${crypto.randomUUID()}`,
    tags: ['smoke'],
    categoryId,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const link = createLink(parsed.value);
  createdLinks.push(link.id);
  await remote.upsertLink(link);
  return link;
}

async function pulledLink(id: string): Promise<Link | undefined> {
  return (await remote.pullLinks(null)).find((l) => l.id === id);
}

beforeAll(async () => {
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (!signIn.error) return;
  const signUp = await client.auth.signUp({ email, password });
  if (signUp.error) {
    throw new Error(`Sign-in failed (${signIn.error.message}) and sign-up failed (${signUp.error.message}).`);
  }
  if (!signUp.data.session) {
    throw new Error(
      `Created ${email}, but the project requires email confirmation. Confirm the address from the email, ` +
        'or turn off "Confirm email" in Supabase (Authentication > Sign In / Providers > Email), then rerun.',
    );
  }
});

afterAll(async () => {
  if (createdLinks.length > 0) await client.from('links').delete().in('id', createdLinks);
  if (createdCategories.length > 0) await client.from('categories').delete().in('id', createdCategories);
  await client.auth.signOut();
});

describe('live Supabase project', () => {
  it('round-trips a category and a link, and keeps the visit count when the link is saved again', async () => {
    const category = await saveCategory('Smoke');
    const link = await saveLink(category.id);
    await remote.incrementVisit(link.id);
    await remote.incrementVisit(link.id);
    await remote.upsertLink(updateLink(link, { is_favorite: true }));

    const saved = await pulledLink(link.id);
    const { data } = await client.auth.getSession();
    expect(saved).toMatchObject({
      url: link.url,
      url_key: link.url_key,
      category_id: category.id,
      tags: ['smoke'],
      is_favorite: true,
      visit_count: 2,
      user_id: data.session?.user.id,
    });
    expect(saved?.last_visited_at).not.toBeNull();
    expect(await remote.findLinkByUrlKey(link.url_key)).toMatchObject({ id: link.id });
    expect((await remote.listCategories()).map((c) => c.id)).toContain(category.id);
  });

  it('uncategorizes links when their category is soft-deleted', async () => {
    const category = await saveCategory('Smoke delete');
    const link = await saveLink(category.id);

    await remote.upsertCategory(updateCategory(category, { deleted_at: new Date().toISOString() }));

    expect((await pulledLink(link.id))?.category_id).toBeNull();
    expect((await remote.listCategories()).map((c) => c.id)).not.toContain(category.id);
    const tombstone = (await remote.pullCategories(null)).find((c) => c.id === category.id);
    expect(tombstone?.deleted_at).not.toBeNull();
  });

  it('pulls every row exactly once when each page holds a single row', async () => {
    const category = await saveCategory('Smoke paging');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await saveLink(category.id)).id);
    const saved = (await remote.pullLinks(null)).filter((l) => ids.includes(l.id));
    expect(saved).toHaveLength(3);
    // Just before the oldest of the new rows, so the pull covers at least those three.
    const since = new Date(Math.min(...saved.map((l) => Date.parse(l.updated_at))) - 1).toISOString();

    const expected = (await remote.pullLinks(since)).map((l) => l.id);
    const paged = (await new SupabaseRemote(client, { pageSize: 1 }).pullLinks(since)).map((l) => l.id);

    expect(paged.length).toBeGreaterThanOrEqual(3);
    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toEqual(expect.arrayContaining(ids));
    expect(paged).toEqual(expected);
  });

  it('shows nothing to a signed-out client', async () => {
    const anon = createStowClient(url, publishableKey, memoryStorage());
    const { data } = await anon.from('links').select('id').limit(1);
    expect(data ?? []).toEqual([]);
    expect(await fetchMetadata(anon, 'https://example.com/')).toBeNull();
  });

  it.runIf(process.env.SMOKE_EDGE === '1')('fetches page metadata through the Edge Function', async () => {
    const meta = await fetchMetadata(client, 'https://example.com/');
    expect(meta?.title).toBe('Example Domain');
  });
});
