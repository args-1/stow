import {
  DEFAULT_CATEGORY_ICON,
  type Category,
  type Link,
  type LocalChange,
  type LocalStore,
  type Mutation,
  type OutboxEntry,
  type SyncTable,
} from '@stow/core';
import { Dexie, type EntityTable } from 'dexie';

export interface MetaRow {
  key: string;
  value: string;
}

export type StowDb = Dexie & {
  links: EntityTable<Link, 'id'>;
  categories: EntityTable<Category, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  meta: EntityTable<MetaRow, 'key'>;
};

export const DB_NAME = 'stow';
/** The database name before the app was renamed to Stow. Its data is imported once, then it is deleted. */
export const LEGACY_DB_NAME = 'linkstash';

/**
 * Opens a database. When `legacyName` is set, opening first copies that database in (see importLegacyDb);
 * Dexie holds every other request on the returned db until the copy has finished.
 */
export function openDb(
  name = DB_NAME,
  legacyName: string | null = name === DB_NAME ? LEGACY_DB_NAME : null,
): StowDb {
  const db = new Dexie(name) as StowDb;
  db.version(1).stores({
    links: 'id',
    categories: 'id',
    outbox: '++seq',
    meta: 'key',
  });
  if (legacyName) db.on('ready', (vipDb) => importLegacyDb(vipDb as StowDb, legacyName));
  return db;
}

/** Categories saved before category icons existed have no icon. */
const withDefaultIcon = (category: Category): Category => ({
  ...category,
  icon: category.icon ?? DEFAULT_CATEGORY_ICON,
});

const withIcon = (mutation: Mutation): Mutation =>
  mutation.type === 'upsertCategory' ? { ...mutation, row: withDefaultIcon(mutation.row) } : mutation;

/**
 * Copies `legacyName` into `db` once, then deletes it. Copies nothing, and keeps the legacy database, when `db`
 * already has data. Runs in Dexie's ready hook, so `db` must be the hook's vipDb: a query through the outer db
 * would wait for this hook and deadlock. If this throws, opening fails and the import runs again next time.
 */
async function importLegacyDb(db: StowDb, legacyName: string): Promise<void> {
  if (!(await Dexie.exists(legacyName))) return;

  const legacy = openDb(legacyName, null);
  let rows: [Link[], Category[], OutboxEntry[], MetaRow[]];
  try {
    rows = await Promise.all([
      legacy.links.toArray(),
      legacy.categories.toArray(),
      legacy.outbox.orderBy('seq').toArray(),
      legacy.meta.toArray(),
    ]);
  } finally {
    legacy.close();
  }
  const [links, categories, outbox, meta] = rows;

  const empty = links.length + categories.length + outbox.length + meta.length === 0;
  // The emptiness check and the copy share one transaction, so a second tab importing at the same time copies nothing.
  const copied =
    !empty &&
    (await db.transaction('rw', db.tables, async () => {
      const counts = await Promise.all(db.tables.map((table) => table.count()));
      if (counts.some((count) => count > 0)) return false;
      await db.links.bulkAdd(links);
      await db.categories.bulkAdd(categories.map(withDefaultIcon));
      // Original seq values keep the push order of unsynced changes.
      await db.outbox.bulkAdd(outbox.map((entry) => ({ ...entry, mutation: withIcon(entry.mutation) })));
      await db.meta.bulkAdd(meta);
      return true;
    }));

  if (empty || copied) {
    // Not awaited: a tab still running the old build can block the delete, and start-up must not wait for it.
    void Dexie.delete(legacyName).catch((error: unknown) =>
      console.warn('Could not delete the old Linkstash database', error),
    );
  }
}

export interface OwnerClaim {
  /** The device held another account's data. */
  switched: boolean;
  /** Unsynced changes wiped along with the previous data. */
  discarded: number;
}

const OWNER_KEY = 'owner';
const cursorKey = (table: SyncTable) => `cursor:${table}`;

export class DexieLocalStore implements LocalStore {
  readonly db: StowDb;

  constructor(db: StowDb) {
    this.db = db;
  }

  getLink(id: string) {
    return this.db.links.get(id);
  }

  getCategory(id: string) {
    return this.db.categories.get(id);
  }

  listLinks() {
    return this.db.links.toArray();
  }

  listCategories() {
    return this.db.categories.toArray();
  }

  async apply(change: LocalChange) {
    const { links, categories, outbox } = this.db;
    await this.db.transaction('rw', [links, categories, outbox], async () => {
      if (change.links?.length) await links.bulkPut(change.links);
      if (change.categories?.length) await categories.bulkPut(change.categories);
      for (const mutation of change.mutations ?? []) await outbox.add({ mutation });
    });
  }

  peekOutbox() {
    return this.db.outbox.toArray();
  }

  peekOutboxHead() {
    return this.db.outbox.orderBy('seq').first();
  }

  async removeOutbox(seq: number) {
    await this.db.outbox.delete(seq);
  }

  async getCursor(table: SyncTable) {
    return (await this.db.meta.get(cursorKey(table)))?.value ?? null;
  }

  async setCursor(table: SyncTable, cursor: string) {
    await this.db.meta.put({ key: cursorKey(table), value: cursor });
  }

  async clear() {
    await this.db.transaction('rw', this.db.tables, async () => {
      await Promise.all(this.db.tables.map((table) => table.clear()));
    });
  }

  async getOwner() {
    return (await this.db.meta.get(OWNER_KEY))?.value ?? null;
  }

  /**
   * Claims this device's data for `userId`. Data owned by anyone else (or by no one) is wiped first;
   * `discarded` counts the unsynced changes that went with it.
   */
  async ensureOwner(userId: string): Promise<OwnerClaim> {
    return this.db.transaction('rw', this.db.tables, async () => {
      const owner = await this.getOwner();
      if (owner === userId) return { switched: false, discarded: 0 };
      const discarded = await this.db.outbox.count();
      await Promise.all(this.db.tables.map((table) => table.clear()));
      await this.db.meta.put({ key: OWNER_KEY, value: userId });
      return { switched: owner !== null, discarded };
    });
  }
}
