import type { Category, Link, LocalChange, LocalStore, OutboxEntry, SyncTable } from '@linkstash/core';
import { Dexie, type EntityTable } from 'dexie';

export interface MetaRow {
  key: string;
  value: string;
}

export type LinkstashDb = Dexie & {
  links: EntityTable<Link, 'id'>;
  categories: EntityTable<Category, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  meta: EntityTable<MetaRow, 'key'>;
};

export function openDb(name = 'linkstash'): LinkstashDb {
  const db = new Dexie(name) as LinkstashDb;
  db.version(1).stores({
    links: 'id',
    categories: 'id',
    outbox: '++seq',
    meta: 'key',
  });
  return db;
}

const OWNER_KEY = 'owner';
const cursorKey = (table: SyncTable) => `cursor:${table}`;

export class DexieLocalStore implements LocalStore {
  readonly db: LinkstashDb;

  constructor(db: LinkstashDb) {
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

  async ensureOwner(userId: string): Promise<boolean> {
    return this.db.transaction('rw', this.db.tables, async () => {
      const owner = await this.getOwner();
      if (owner === userId) return false;
      await Promise.all(this.db.tables.map((table) => table.clear()));
      await this.db.meta.put({ key: OWNER_KEY, value: userId });
      return owner !== null;
    });
  }
}
