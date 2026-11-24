import type { SupabaseClient } from '@supabase/supabase-js';
import { RemoteError, type Remote } from './remote';
import type { Category, Link, SyncTable } from './schema';

const DEFAULT_PAGE_SIZE = 1000;

/** The part of a supabase-js query result this module reads. */
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  status: number;
}

/** Awaits a supabase-js query and turns any failure into a RemoteError. Status 0 means the server was never reached. */
async function run(operation: string, query: PromiseLike<QueryResult>): Promise<unknown> {
  let result: QueryResult;
  try {
    result = await query;
  } catch (error) {
    throw new RemoteError(`${operation}: ${error instanceof Error ? error.message : String(error)}`, 0);
  }
  if (result.error) throw new RemoteError(`${operation}: ${result.error.message}`, result.status);
  return result.data;
}

/**
 * The link columns a client may write. The server owns user_id (default auth.uid()) and updated_at (trigger),
 * and increment_visit owns visit_count and last_visited_at, so re-saving a link never resets its visits.
 */
function linkPayload(row: Link) {
  return {
    id: row.id,
    url: row.url,
    url_key: row.url_key,
    title: row.title,
    custom_title: row.custom_title,
    description: row.description,
    favicon_url: row.favicon_url,
    notes: row.notes,
    tags: row.tags,
    category_id: row.category_id,
    is_favorite: row.is_favorite,
    is_archived: row.is_archived,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

function categoryPayload(row: Category) {
  return { id: row.id, name: row.name, color: row.color, created_at: row.created_at, deleted_at: row.deleted_at };
}

export interface SupabaseRemoteOptions {
  /** Rows per pull request. Tests pass a small value to exercise paging. */
  pageSize?: number;
}

export class SupabaseRemote implements Remote {
  private readonly client: SupabaseClient;
  private readonly pageSize: number;

  constructor(client: SupabaseClient, options: SupabaseRemoteOptions = {}) {
    this.client = client;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  pullLinks(since: string | null): Promise<Link[]> {
    return this.pull<Link>('links', since);
  }

  pullCategories(since: string | null): Promise<Category[]> {
    return this.pull<Category>('categories', since);
  }

  async upsertLink(row: Link): Promise<void> {
    await run('save link', this.client.from('links').upsert(linkPayload(row), { onConflict: 'id' }));
  }

  async upsertCategory(row: Category): Promise<void> {
    await run('save category', this.client.from('categories').upsert(categoryPayload(row), { onConflict: 'id' }));
  }

  async incrementVisit(id: string): Promise<void> {
    await run('record visit', this.client.rpc('increment_visit', { link_id: id }));
  }

  /** The most recently updated live link with this dedupe key. The extension uses it to spot duplicates. */
  async findLinkByUrlKey(urlKey: string): Promise<Link | null> {
    const query = this.client
      .from('links')
      .select('*')
      .eq('url_key', urlKey)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    const rows = (await run('find link', query)) as Link[];
    return rows[0] ?? null;
  }

  /** Live categories sorted by name. The extension has no local store, so it reads them from the server. */
  async listCategories(): Promise<Category[]> {
    const query = this.client.from('categories').select('*').is('deleted_at', null).order('name', { ascending: true });
    return (await run('list categories', query)) as Category[];
  }

  /**
   * Reads rows with updated_at > since, ordered by (updated_at, id), one page at a time. Each page starts
   * after the previous page's last (updated_at, id) pair, so rows sharing a timestamp across a page boundary
   * are neither skipped nor repeated. Values in an `or` filter are double-quoted because they contain `.` and `:`.
   */
  private async pull<T extends { id: string; updated_at: string }>(table: SyncTable, since: string | null): Promise<T[]> {
    const rows: T[] = [];
    let last: T | undefined;
    for (;;) {
      let query = this.client.from(table).select('*');
      if (since !== null) query = query.gt('updated_at', since);
      if (last) {
        const at = `"${last.updated_at}"`;
        query = query.or(`updated_at.gt.${at},and(updated_at.eq.${at},id.gt."${last.id}")`);
      }
      const ordered = query.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(this.pageSize);
      const page = (await run(`pull ${table}`, ordered)) as T[];
      rows.push(...page);
      if (page.length < this.pageSize) return rows;
      last = page[page.length - 1];
    }
  }
}
