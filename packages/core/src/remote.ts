import type { Category, Link } from './schema';

export class RemoteError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  /** PostgREST or Postgres error code, when the server sent one. */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'RemoteError';
    this.status = status;
    this.code = code;
  }
}

export type ErrorKind = 'auth' | 'retryable' | 'fatal';

/** PostgREST's "column not in the schema cache": the client is newer than the database's migrations. */
const MISSING_COLUMN = 'PGRST204';

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof RemoteError)) return 'retryable';
  if (error.code === MISSING_COLUMN) return 'retryable';
  const { status } = error;
  if (status === 401) return 'auth';
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'retryable';
  return 'fatal';
}

/** Server operations the sync engine needs. Implemented by SupabaseRemote and FakeRemote. */
export interface Remote {
  /** Rows with updated_at > since (all rows when since is null), tombstones included, oldest first. */
  pullLinks(since: string | null): Promise<Link[]>;
  pullCategories(since: string | null): Promise<Category[]>;
  upsertLink(row: Link): Promise<void>;
  upsertCategory(row: Category): Promise<void>;
  incrementVisit(id: string): Promise<void>;
}
