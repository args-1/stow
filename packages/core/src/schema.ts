export interface Link {
  id: string;
  /** Filled by the server (default auth.uid()); absent on rows created on this device. */
  user_id?: string;
  url: string;
  url_key: string;
  title: string;
  custom_title: string | null;
  description: string | null;
  favicon_url: string | null;
  notes: string | null;
  tags: string[];
  category_id: string | null;
  is_favorite: boolean;
  is_archived: boolean;
  visit_count: number;
  last_visited_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Category {
  id: string;
  user_id?: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type Mutation =
  | { type: 'upsertLink'; row: Link }
  | { type: 'upsertCategory'; row: Category }
  | { type: 'visit'; id: string };

export interface OutboxEntry {
  seq: number;
  mutation: Mutation;
}

export type SyncTable = 'links' | 'categories';

export const CATEGORY_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
] as const;

export function mutationTargetId(m: Mutation): string {
  return m.type === 'visit' ? m.id : m.row.id;
}
