import type { Category, Link, Mutation, OutboxEntry, SyncTable } from './schema';

export interface LocalChange {
  links?: Link[];
  categories?: Category[];
  mutations?: Mutation[];
}

/** Device-local storage for the PWA: rows, the pending-write outbox, and pull cursors. */
export interface LocalStore {
  getLink(id: string): Promise<Link | undefined>;
  getCategory(id: string): Promise<Category | undefined>;
  listLinks(): Promise<Link[]>;
  listCategories(): Promise<Category[]>;
  /** Upserts rows and appends mutations to the outbox as one atomic step. */
  apply(change: LocalChange): Promise<void>;
  /** All outbox entries in ascending seq order, without removing them. */
  peekOutbox(): Promise<OutboxEntry[]>;
  /** The oldest outbox entry, or undefined when the outbox is empty. */
  peekOutboxHead(): Promise<OutboxEntry | undefined>;
  removeOutbox(seq: number): Promise<void>;
  getCursor(table: SyncTable): Promise<string | null>;
  setCursor(table: SyncTable, cursor: string): Promise<void>;
  /** Removes rows, outbox entries, and cursors. Seq numbers keep increasing afterwards. */
  clear(): Promise<void>;
}

export class MemoryLocalStore implements LocalStore {
  private links = new Map<string, Link>();
  private categories = new Map<string, Category>();
  private outbox: OutboxEntry[] = [];
  private cursors = new Map<SyncTable, string>();
  private seq = 0;

  async getLink(id: string) {
    const row = this.links.get(id);
    return row && structuredClone(row);
  }

  async getCategory(id: string) {
    const row = this.categories.get(id);
    return row && structuredClone(row);
  }

  async listLinks() {
    return [...this.links.values()].map((r) => structuredClone(r));
  }

  async listCategories() {
    return [...this.categories.values()].map((r) => structuredClone(r));
  }

  async apply(change: LocalChange) {
    for (const row of change.links ?? []) this.links.set(row.id, structuredClone(row));
    for (const row of change.categories ?? []) this.categories.set(row.id, structuredClone(row));
    for (const mutation of change.mutations ?? []) {
      this.seq += 1;
      this.outbox.push({ seq: this.seq, mutation: structuredClone(mutation) });
    }
  }

  async peekOutbox() {
    return structuredClone(this.outbox);
  }

  async peekOutboxHead() {
    const head = this.outbox[0];
    return head && structuredClone(head);
  }

  async removeOutbox(seq: number) {
    this.outbox = this.outbox.filter((e) => e.seq !== seq);
  }

  async getCursor(table: SyncTable) {
    return this.cursors.get(table) ?? null;
  }

  async setCursor(table: SyncTable, cursor: string) {
    this.cursors.set(table, cursor);
  }

  async clear() {
    this.links.clear();
    this.categories.clear();
    this.outbox = [];
    this.cursors.clear();
  }
}
