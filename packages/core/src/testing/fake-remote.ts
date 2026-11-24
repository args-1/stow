import type { Remote } from '../remote';
import type { Category, Link, SyncTable } from '../schema';

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

function rowsSince<T extends { updated_at: string }>(rows: Map<string, T>, since: string | null): T[] {
  const after = since === null ? -Infinity : Date.parse(since);
  return [...rows.values()]
    .filter((r) => Date.parse(r.updated_at) > after)
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
    .map((r) => structuredClone(r));
}

/** In-memory Remote that behaves like the server: stamps updated_at, preserves visit counts, fails on demand. */
export class FakeRemote implements Remote {
  readonly links = new Map<string, Link>();
  readonly categories = new Map<string, Category>();
  /** Every call in order, including ones that failed. */
  readonly calls: string[] = [];
  readonly sinceLog: { table: SyncTable; since: string | null }[] = [];
  private failures: unknown[] = [];
  private tick = 0;

  /** Makes the next calls throw these errors, one per call, in order. */
  failNext(...errors: unknown[]): void {
    this.failures.push(...errors);
  }

  /** Simulates a write from another device. */
  serverWriteLink(row: Link): Link {
    const saved = { ...structuredClone(row), updated_at: this.stamp() };
    this.links.set(saved.id, saved);
    return structuredClone(saved);
  }

  serverWriteCategory(row: Category): Category {
    const saved = { ...structuredClone(row), updated_at: this.stamp() };
    this.categories.set(saved.id, saved);
    return structuredClone(saved);
  }

  async pullLinks(since: string | null): Promise<Link[]> {
    await this.step('pullLinks');
    this.sinceLog.push({ table: 'links', since });
    return rowsSince(this.links, since);
  }

  async pullCategories(since: string | null): Promise<Category[]> {
    await this.step('pullCategories');
    this.sinceLog.push({ table: 'categories', since });
    return rowsSince(this.categories, since);
  }

  async upsertLink(row: Link): Promise<void> {
    await this.step(`upsertLink:${row.id}`);
    const existing = this.links.get(row.id);
    this.links.set(row.id, {
      ...structuredClone(row),
      visit_count: existing?.visit_count ?? 0,
      last_visited_at: existing?.last_visited_at ?? null,
      updated_at: this.stamp(),
    });
  }

  async upsertCategory(row: Category): Promise<void> {
    await this.step(`upsertCategory:${row.id}`);
    this.categories.set(row.id, { ...structuredClone(row), updated_at: this.stamp() });
  }

  async incrementVisit(id: string): Promise<void> {
    await this.step(`incrementVisit:${id}`);
    const link = this.links.get(id);
    if (!link) return;
    const now = this.stamp();
    this.links.set(id, { ...link, visit_count: link.visit_count + 1, last_visited_at: now, updated_at: now });
  }

  private stamp(): string {
    this.tick += 1;
    return new Date(EPOCH + this.tick * 1000).toISOString();
  }

  private async step(call: string): Promise<void> {
    this.calls.push(call);
    if (this.failures.length > 0) throw this.failures.shift();
  }
}
