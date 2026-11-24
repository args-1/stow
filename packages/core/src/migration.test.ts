import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORY_ICONS } from './schema';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0001_init.sql', import.meta.url), 'utf8');
const MIGRATION_0002 = readFileSync(
  new URL('../../../supabase/migrations/0002_category_icons.sql', import.meta.url),
  'utf8',
);

/** The pieces of a Supabase database that the migration relies on. */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create publication supabase_realtime;
`;

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const CAT = '10000000-0000-4000-8000-000000000001';
const LINK = '20000000-0000-4000-8000-000000000001';
const FRESH = '10000000-0000-4000-8000-000000000002';

let db: PGlite;

/** Runs fn as a signed-in user, or as the anon role when user is null. */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function aliceLink() {
  const [link] = await as(ALICE, () =>
    rows<{ title: string; category_id: string | null; visit_count: number; updated_at: Date }>(
      'select title, category_id, visit_count, updated_at from public.links where id = $1',
      [LINK],
    ),
  );
  return link;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(MIGRATION);
  await db.query('insert into auth.users (id) values ($1), ($2)', [ALICE, BOB]);
  await as(ALICE, async () => {
    await db.query(`insert into public.categories (id, name, color) values ($1, 'Work', '#3b82f6')`, [CAT]);
    await db.query(
      `insert into public.links (id, url, url_key, title, category_id, updated_at)
       values ($1, 'https://a.io/', 'a.io', 'A', $2, '2000-01-01T00:00:00Z')`,
      [LINK, CAT],
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('0001_init.sql', () => {
  it('fills user_id from the session and stamps updated_at on the server', async () => {
    const [row] = await as(ALICE, () => rows<{ user_id: string }>('select user_id from public.links where id = $1', [LINK]));
    expect(row.user_id).toBe(ALICE);
    expect((await aliceLink()).updated_at.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("hides other users' rows and ignores their writes", async () => {
    const before = await aliceLink();
    await as(BOB, async () => {
      expect(await rows('select id from public.links')).toEqual([]);
      expect(await rows('select id from public.categories')).toEqual([]);
      const update = await db.query(`update public.links set title = 'pwned' where id = $1`, [LINK]);
      expect(update.affectedRows).toBe(0);
      await db.query('select public.increment_visit($1)', [LINK]);
    });
    expect(await aliceLink()).toMatchObject({ title: before.title, visit_count: before.visit_count });
  });

  it('rejects rows written on behalf of another user', async () => {
    await expect(
      as(BOB, () =>
        db.query(`insert into public.links (id, user_id, url, url_key) values (gen_random_uuid(), $1, 'https://b.io/', 'b.io')`, [
          ALICE,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('gives anonymous clients nothing', async () => {
    await as(null, async () => {
      expect(await rows('select id from public.links')).toEqual([]);
      await expect(db.query('select public.increment_visit($1)', [LINK])).rejects.toThrow(/permission denied/);
    });
  });

  it('enforces the same limits as the client', async () => {
    await as(ALICE, async () => {
      await expect(
        db.query(`insert into public.links (id, url, url_key) values (gen_random_uuid(), 'ftp://x.io/', 'x.io')`),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(`insert into public.categories (id, name, color) values (gen_random_uuid(), 'X', 'blue')`),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(`insert into public.categories (id, name, color) values (gen_random_uuid(), '', '#3b82f6')`),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it('counts visits and keeps them through an upsert that omits them, as SupabaseRemote sends', async () => {
    const before = await aliceLink();
    await as(ALICE, async () => {
      await db.query('select public.increment_visit($1)', [LINK]);
      await db.query(
        `insert into public.links (id, url, url_key, title) values ($1, 'https://a.io/', 'a.io', 'A2')
         on conflict (id) do update set url = excluded.url, url_key = excluded.url_key, title = excluded.title`,
        [LINK],
      );
    });
    expect(await aliceLink()).toMatchObject({ title: 'A2', visit_count: before.visit_count + 1 });
  });

  it('uncategorizes links when their category is soft-deleted', async () => {
    const before = await aliceLink();
    expect(before.category_id).toBe(CAT);
    await as(ALICE, () => db.query('update public.categories set deleted_at = now() where id = $1', [CAT]));
    const after = await aliceLink();
    expect(after.category_id).toBeNull();
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  it('publishes both tables to Realtime', async () => {
    const tables = await rows<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`,
    );
    expect(tables.map((t) => t.tablename)).toEqual(['categories', 'links']);
  });
});

describe('0002_category_icons.sql', () => {
  let catUpdatedAt: Date;

  beforeAll(async () => {
    [{ updated_at: catUpdatedAt }] = await rows<{ updated_at: Date }>(
      'select updated_at from public.categories where id = $1',
      [CAT],
    );
    await db.exec(MIGRATION_0002);
  });

  it('gives existing categories the folder icon without touching updated_at', async () => {
    const [cat] = await rows<{ icon: string; updated_at: Date }>(
      'select icon, updated_at from public.categories where id = $1',
      [CAT],
    );
    expect(cat.icon).toBe('folder');
    expect(cat.updated_at.getTime()).toBe(catUpdatedAt.getTime());
  });

  it('defaults new categories to folder and stores the icon the client sends', async () => {
    await as(ALICE, async () => {
      await db.query(`insert into public.categories (id, name, color) values ($1, 'Fresh', '#3b82f6')`, [FRESH]);
      expect(await rows('select icon from public.categories where id = $1', [FRESH])).toEqual([{ icon: 'folder' }]);
      await db.query(`update public.categories set icon = 'briefcase' where id = $1`, [FRESH]);
      expect(await rows('select icon from public.categories where id = $1', [FRESH])).toEqual([{ icon: 'briefcase' }]);
    });
  });

  it.each(CATEGORY_ICONS)('accepts the icon name %j', async (icon) => {
    await as(ALICE, async () => {
      await db.query('update public.categories set icon = $1 where id = $2', [icon, FRESH]);
      expect(await rows('select icon from public.categories where id = $1', [FRESH])).toEqual([{ icon }]);
    });
  });

  it.each(['Bad Icon', 'a'.repeat(41), ''])('rejects the icon name %j', async (icon) => {
    await expect(
      as(ALICE, () =>
        db.query(`insert into public.categories (id, name, color, icon) values (gen_random_uuid(), 'X', '#3b82f6', $1)`, [
          icon,
        ]),
      ),
    ).rejects.toThrow(/categories_icon_format/);
  });
});
