import type { Category, Link } from '../schema';
import { dedupeKey } from '../url';

const T0 = '2026-01-01T00:00:00.000Z';
let linkSeq = 0;
let categorySeq = 0;

export function makeLink(over: Partial<Link> = {}): Link {
  linkSeq += 1;
  const url = over.url ?? `https://example${linkSeq}.com/`;
  return {
    id: `link-${linkSeq}`,
    url,
    url_key: dedupeKey(url),
    title: `Example ${linkSeq}`,
    custom_title: null,
    description: null,
    favicon_url: null,
    notes: null,
    tags: [],
    category_id: null,
    is_favorite: false,
    is_archived: false,
    visit_count: 0,
    last_visited_at: null,
    created_at: T0,
    updated_at: T0,
    deleted_at: null,
    ...over,
  };
}

export function makeCategory(over: Partial<Category> = {}): Category {
  categorySeq += 1;
  return {
    id: `cat-${categorySeq}`,
    name: `Category ${categorySeq}`,
    color: '#3b82f6',
    icon: 'folder',
    created_at: T0,
    updated_at: T0,
    deleted_at: null,
    ...over,
  };
}
