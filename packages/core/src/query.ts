import { displayTitle } from './model';
import type { Category, Link } from './schema';
import { dedupeKey, normalizeUrl } from './url';

export type LinkView = 'all' | 'favorites' | 'archive';
export type LinkSort = 'newest' | 'oldest' | 'alpha' | 'visits';

export interface LinkQuery {
  search?: string;
  categoryId?: string | null;
  view?: LinkView;
  sort?: LinkSort;
}

// Server rows ("…+00:00", microseconds) and local rows ("…Z") use different formats, so compare instants.
const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

const byNewest = (a: Link, b: Link) => time(b.created_at) - time(a.created_at) || a.id.localeCompare(b.id);

const COMPARATORS: Record<LinkSort, (a: Link, b: Link) => number> = {
  newest: byNewest,
  oldest: (a, b) => -byNewest(a, b),
  alpha: (a, b) => displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }) || byNewest(a, b),
  visits: (a, b) => b.visit_count - a.visit_count || byNewest(a, b),
};

function searchTerms(search: string): string[] {
  return search
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^#+/, ''))
    .filter(Boolean);
}

function haystack(link: Link): string {
  return [link.title, link.custom_title, link.url, link.description, link.notes, link.tags.join(' ')]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function queryLinks(links: readonly Link[], query: LinkQuery = {}): Link[] {
  const view = query.view ?? 'all';
  const terms = searchTerms(query.search ?? '');
  return links
    .filter((link) => {
      if (link.deleted_at) return false;
      if (view === 'archive' ? !link.is_archived : link.is_archived) return false;
      if (view === 'favorites' && !link.is_favorite) return false;
      if (query.categoryId && link.category_id !== query.categoryId) return false;
      if (terms.length === 0) return true;
      const text = haystack(link);
      return terms.every((t) => text.includes(t));
    })
    .sort(COMPARATORS[query.sort ?? 'newest']);
}

export function findByUrl(links: readonly Link[], rawUrl: string): Link | undefined {
  const url = normalizeUrl(rawUrl);
  if (!url) return undefined;
  const key = dedupeKey(url);
  return links.find((l) => !l.deleted_at && l.url_key === key);
}

export function activeCategories(categories: readonly Category[]): Category[] {
  return categories
    .filter((c) => !c.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function countByCategory(links: readonly Link[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of links) {
    if (l.deleted_at || l.is_archived || !l.category_id) continue;
    counts[l.category_id] = (counts[l.category_id] ?? 0) + 1;
  }
  return counts;
}
