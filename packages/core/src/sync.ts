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
  private running: { promise: Promise<SyncResult>; signal: AbortSignal | undefined } | null = null;
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

  /**
   * Pushes the outbox, then pulls server changes. Overlapping calls with the same signal share one run
   * and trigger one more cycle. Once `signal` aborts, the run rejects with its reason without pushing
   * further entries, applying pulled rows, or moving a cursor.
   */
  sync(signal?: AbortSignal): Promise<SyncResult> {
    const current = this.running;
    if (current) {
      if (current.signal === signal && !signal?.aborted) {
        this.dirty = true;
        return current.promise;
      }
      // The current run belongs to another (possibly aborted) session; start fresh once it settles.
      const next = () => this.sync(signal);
      return current.promise.then(next, next);
    }
    if (signal?.aborted) return Promise.reject(signal.reason);
    const promise = (async () => {
      try {
        let result: SyncResult;
        do {
          this.dirty = false;
          result = await this.cycle(signal);
        } while (this.dirty && result === 'ok');
        signal?.throwIfAborted();
        return result;
      } finally {
        this.running = null;
      }
    })();
    this.running = { promise, signal };
    return promise;
  }

  private async flush(signal: AbortSignal | undefined): Promise<SyncResult> {
    for (;;) {
      signal?.throwIfAborted();
      // Re-read the head before every push: an entry removed by a wipe must never reach the server.
      const entry = await this.local.peekOutboxHead();
      if (!entry) return 'ok';
      signal?.throwIfAborted();
      try {
        await this.push(entry.mutation);
      } catch (error) {
        signal?.throwIfAborted();
        const kind = errorKind(error);
        if (kind === 'auth') return 'auth';
        if (kind === 'retryable') return 'retry';
        this.options.onFatalError?.(error, entry.mutation);
      }
      await this.local.removeOutbox(entry.seq);
    }
  }

  private async pull(signal: AbortSignal | undefined): Promise<void> {
    await this.pullTable(
      'categories',
      (since) => this.remote.pullCategories(since),
      (rows) => ({ categories: rows }),
      signal,
    );
    await this.pullTable('links', (since) => this.remote.pullLinks(since), (rows) => ({ links: rows }), signal);
  }

  private async cycle(signal: AbortSignal | undefined): Promise<SyncResult> {
    const pushed = await this.flush(signal);
    if (pushed !== 'ok') return pushed;
    try {
      await this.pull(signal);
      return 'ok';
    } catch (error) {
      signal?.throwIfAborted();
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
    signal: AbortSignal | undefined,
  ): Promise<void> {
    signal?.throwIfAborted();
    const cursor = await this.local.getCursor(table);
    const since = cursor === null ? null : new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString();
    const rows = await fetchSince(since);
    if (rows.length === 0) return;
    await this.exclusive(async () => {
      // Read pending ids after the fetch so writes made during the request are respected.
      const pending = new Set((await this.local.peekOutbox()).map((e) => mutationTargetId(e.mutation)));
      // Checked right before each write: rows fetched for a signed-out session must not land in the next one.
      signal?.throwIfAborted();
      await this.local.apply(toChange(rows.filter((r) => !pending.has(r.id))));
      let max = cursor === null ? 0 : Date.parse(cursor);
      for (const r of rows) max = Math.max(max, Date.parse(r.updated_at));
      signal?.throwIfAborted();
      await this.local.setCursor(table, new Date(max).toISOString());
    });
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn);
    this.lock = result.catch(() => undefined);
    return result;
  }
}
