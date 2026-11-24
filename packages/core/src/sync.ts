import type { LocalChange, LocalStore } from './local';
import { errorKind, type Remote } from './remote';
import { mutationTargetId, type Category, type Link, type Mutation, type SyncTable } from './schema';

export type SyncResult = 'ok' | 'retry' | 'auth';

/** Each pull re-reads this window before the cursor so rows committed slightly out of order are not missed. */
export const PULL_OVERLAP_MS = 5000;

export interface SyncEngineOptions {
  /** Called when the server permanently rejects a mutation. The mutation is dropped. */
  onFatalError?: (error: unknown, mutation: Mutation) => void;
}

export class SyncEngine {
  private readonly local: LocalStore;
  private readonly remote: Remote;
  private readonly options: SyncEngineOptions;
  /** Serializes local read-modify-write steps so pulled rows never clobber a concurrent save. */
  private lock: Promise<unknown> = Promise.resolve();
  private running: Promise<SyncResult> | null = null;
  private dirty = false;

  constructor(local: LocalStore, remote: Remote, options: SyncEngineOptions = {}) {
    this.local = local;
    this.remote = remote;
    this.options = options;
  }

  saveLink(row: Link): Promise<void> {
    return this.exclusive(() => this.local.apply({ links: [row], mutations: [{ type: 'upsertLink', row }] }));
  }

  saveCategory(row: Category): Promise<void> {
    return this.exclusive(() => this.local.apply({ categories: [row], mutations: [{ type: 'upsertCategory', row }] }));
  }

  recordVisit(id: string, now: string): Promise<void> {
    return this.exclusive(async () => {
      const link = await this.local.getLink(id);
      if (!link) return;
      await this.local.apply({
        links: [{ ...link, visit_count: link.visit_count + 1, last_visited_at: now }],
        mutations: [{ type: 'visit', id }],
      });
    });
  }

  async flush(): Promise<SyncResult> {
    for (;;) {
      const entries = await this.local.peekOutbox();
      if (entries.length === 0) return 'ok';
      for (const entry of entries) {
        try {
          await this.push(entry.mutation);
        } catch (error) {
          const kind = errorKind(error);
          if (kind === 'auth') return 'auth';
          if (kind === 'retryable') return 'retry';
          this.options.onFatalError?.(error, entry.mutation);
        }
        await this.local.removeOutbox(entry.seq);
      }
    }
  }

  async pull(): Promise<void> {
    await this.pullTable('categories', (since) => this.remote.pullCategories(since), (rows) => ({ categories: rows }));
    await this.pullTable('links', (since) => this.remote.pullLinks(since), (rows) => ({ links: rows }));
  }

  sync(): Promise<SyncResult> {
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        let result: SyncResult;
        do {
          this.dirty = false;
          result = await this.cycle();
        } while (this.dirty && result === 'ok');
        return result;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async cycle(): Promise<SyncResult> {
    const pushed = await this.flush();
    if (pushed !== 'ok') return pushed;
    try {
      await this.pull();
      return 'ok';
    } catch (error) {
      const kind = errorKind(error);
      if (kind === 'fatal') throw error;
      return kind === 'auth' ? 'auth' : 'retry';
    }
  }

  private push(mutation: Mutation): Promise<void> {
    switch (mutation.type) {
      case 'upsertLink':
        return this.remote.upsertLink(mutation.row);
      case 'upsertCategory':
        return this.remote.upsertCategory(mutation.row);
      case 'visit':
        return this.remote.incrementVisit(mutation.id);
    }
  }

  private async pullTable<T extends { id: string; updated_at: string }>(
    table: SyncTable,
    fetchSince: (since: string | null) => Promise<T[]>,
    toChange: (rows: T[]) => LocalChange,
  ): Promise<void> {
    const cursor = await this.local.getCursor(table);
    const since = cursor === null ? null : new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString();
    const rows = await fetchSince(since);
    if (rows.length === 0) return;
    await this.exclusive(async () => {
      // Read pending ids after the fetch so writes made during the request are respected.
      const pending = new Set((await this.local.peekOutbox()).map((e) => mutationTargetId(e.mutation)));
      await this.local.apply(toChange(rows.filter((r) => !pending.has(r.id))));
      let max = cursor === null ? 0 : Date.parse(cursor);
      for (const r of rows) max = Math.max(max, Date.parse(r.updated_at));
      await this.local.setCursor(table, new Date(max).toISOString());
    });
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn);
    this.lock = result.catch(() => undefined);
    return result;
  }
}
