import { DEFAULT_CATEGORY_ICON, type Category } from '@stow/core';
import { describeLocalStoreContract, makeCategory, makeLink } from '@stow/core/testing';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, DexieLocalStore, LEGACY_DB_NAME, openDb } from './db';

let dbCount = 0;
const freshStore = () => new DexieLocalStore(openDb(`stow-test-${++dbCount}`));

describeLocalStoreContract('DexieLocalStore', freshStore);

describe('DexieLocalStore owner', () => {
  it('records the first owner and keeps data for the same user', async () => {
    const store = freshStore();
    expect(await store.getOwner()).toBeNull();

    expect(await store.ensureOwner('user-a')).toEqual({ switched: false, discarded: 0 });
    const link = makeLink();
    await store.apply({ links: [link], mutations: [{ type: 'visit', id: link.id }] });

    expect(await store.ensureOwner('user-a')).toEqual({ switched: false, discarded: 0 });
    expect(await store.getOwner()).toBe('user-a');
    expect(await store.listLinks()).toEqual([link]);
    expect(await store.peekOutbox()).toHaveLength(1);
  });

  it('wipes everything when a different user signs in and counts the discarded changes', async () => {
    const store = freshStore();
    await store.ensureOwner('user-a');
    await store.apply({
      links: [makeLink()],
      categories: [makeCategory()],
      mutations: [
        { type: 'visit', id: 'x' },
        { type: 'visit', id: 'y' },
      ],
    });
    await store.setCursor('links', '2026-01-02T00:00:00.000Z');

    expect(await store.ensureOwner('user-b')).toEqual({ switched: true, discarded: 2 });
    expect(await store.getOwner()).toBe('user-b');
    expect(await store.listLinks()).toEqual([]);
    expect(await store.listCategories()).toEqual([]);
    expect(await store.peekOutbox()).toEqual([]);
    expect(await store.getCursor('links')).toBeNull();
  });

  it('forgets the owner on clear()', async () => {
    const store = freshStore();
    await store.ensureOwner('user-a');
    await store.clear();
    expect(await store.getOwner()).toBeNull();
  });

  it('wipes rows that have no owner', async () => {
    const store = freshStore();
    await store.apply({ links: [makeLink()], mutations: [{ type: 'visit', id: 'x' }] });

    expect(await store.ensureOwner('user-a')).toEqual({ switched: false, discarded: 1 });
    expect(await store.listLinks()).toEqual([]);
    expect(await store.peekOutbox()).toEqual([]);
  });
});

describe('importing the legacy database', () => {
  let importCount = 0;
  const names = () => ({ name: `stow-import-${++importCount}`, legacy: `legacy-${importCount}` });

  /** A category as the old build stored it: no icon. */
  function legacyCategory(over: Partial<Category> = {}): Category {
    const { icon, ...row } = makeCategory(over);
    return row as Category;
  }

  /** Writes to a database without triggering any import. */
  async function seed(name: string, fill: (store: DexieLocalStore) => Promise<unknown>) {
    const db = openDb(name, null);
    await db.open();
    await fill(new DexieLocalStore(db));
    db.close();
  }

  /** The delete is started but not awaited by the import, so poll for it. */
  async function legacyDeleted(name: string) {
    await vi.waitFor(async () => expect(await Dexie.exists(name)).toBe(false));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies the linkstash database into stow on first open, then deletes it', async () => {
    const link = makeLink();
    const cat = legacyCategory();
    const later = legacyCategory();
    await seed(LEGACY_DB_NAME, async (store) => {
      await store.ensureOwner('user-a');
      await store.apply({
        links: [link],
        categories: [cat],
        mutations: [
          { type: 'visit', id: link.id },
          { type: 'upsertCategory', row: later },
          { type: 'upsertLink', row: link },
        ],
      });
      await store.removeOutbox(1);
      await store.setCursor('links', '2026-01-02T00:00:00.000Z');
    });

    const db = openDb();
    const store = new DexieLocalStore(db);
    try {
      expect(db.name).toBe(DB_NAME);
      expect(await store.listLinks()).toEqual([link]);
      expect(await store.listCategories()).toEqual([{ ...cat, icon: DEFAULT_CATEGORY_ICON }]);
      expect(await store.peekOutbox()).toEqual([
        { seq: 2, mutation: { type: 'upsertCategory', row: { ...later, icon: DEFAULT_CATEGORY_ICON } } },
        { seq: 3, mutation: { type: 'upsertLink', row: link } },
      ]);
      expect(await store.getOwner()).toBe('user-a');
      expect(await store.getCursor('links')).toBe('2026-01-02T00:00:00.000Z');

      await store.apply({ mutations: [{ type: 'visit', id: link.id }] });
      expect((await store.peekOutbox()).map((entry) => entry.seq)).toEqual([2, 3, 4]);
      await legacyDeleted(LEGACY_DB_NAME);
    } finally {
      db.close();
      await Dexie.delete(DB_NAME);
    }
  });

  it('copies nothing and keeps the legacy database when stow already has data', async () => {
    const { name, legacy } = names();
    await seed(legacy, (store) => store.apply({ links: [makeLink({ title: 'old' })] }));
    const existing = makeLink({ title: 'new' });
    await seed(name, (store) => store.apply({ links: [existing] }));
    const remove = vi.spyOn(Dexie, 'delete');

    const db = openDb(name, legacy);
    expect(await new DexieLocalStore(db).listLinks()).toEqual([existing]);
    db.close();

    expect(remove).not.toHaveBeenCalled();
    expect(await Dexie.exists(legacy)).toBe(true);
  });

  it('deletes an empty legacy database', async () => {
    const { name, legacy } = names();
    const empty = openDb(legacy, null);
    await empty.open();
    empty.close();

    const db = openDb(name, legacy);
    expect(await new DexieLocalStore(db).listLinks()).toEqual([]);
    db.close();

    await legacyDeleted(legacy);
  });

  it('does nothing when there is no legacy database', async () => {
    const { name, legacy } = names();

    const db = openDb(name, legacy);
    expect(await new DexieLocalStore(db).listLinks()).toEqual([]);
    db.close();

    expect(await Dexie.exists(legacy)).toBe(false);
  });
});
