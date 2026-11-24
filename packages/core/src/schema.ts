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
  /** A CATEGORY_ICONS name. Rows from other builds may hold names this build doesn't know; render with categoryIconName(). */
  icon: string;
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

export const CATEGORY_ICONS = [
  'folder', 'briefcase', 'house', 'book-open', 'graduation-cap', 'code', 'terminal', 'newspaper',
  'video', 'film', 'music', 'image', 'camera', 'gamepad-2', 'shopping-cart', 'wallet',
  'plane', 'map-pin', 'car', 'utensils', 'coffee', 'heart', 'star', 'bookmark',
  'lightbulb', 'wrench', 'palette', 'pen-tool', 'globe', 'users', 'message-circle', 'mail',
  'calendar', 'file-text', 'archive', 'tag', 'flag', 'rocket', 'dumbbell', 'leaf',
] as const;

export type CategoryIconName = (typeof CATEGORY_ICONS)[number];

export const DEFAULT_CATEGORY_ICON: CategoryIconName = 'folder';

export function isCategoryIcon(value: unknown): value is CategoryIconName {
  return typeof value === 'string' && (CATEGORY_ICONS as readonly string[]).includes(value);
}

/** The icon to draw or edit: `value` when it is a known name, otherwise DEFAULT_CATEGORY_ICON. */
export function categoryIconName(value: unknown): CategoryIconName {
  return isCategoryIcon(value) ? value : DEFAULT_CATEGORY_ICON;
}

export function mutationTargetId(m: Mutation): string {
  return m.type === 'visit' ? m.id : m.row.id;
}
