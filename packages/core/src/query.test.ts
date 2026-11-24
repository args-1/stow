import { describe, expect, it } from 'vitest';
import { activeCategories, countByCategory, findByUrl, queryLinks } from './query';
import type { Category, Link } from './schema';

const T = '2026-01-01T00:00:00.000Z';
let n = 0;
function link(over: Partial<Link> = {}): Link {
  n += 1;
  return {
    id: `l${n}`,
    url: `https://site${n}.com/`,
    url_key: `site${n}.com`,
    title: `Site ${n}`,
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
    created_at: T,
    updated_at: T,
    deleted_at: null,
    ...over,
  };
}
const cat = (over: Partial<Category>): Category => ({
  id: 'c',
  name: 'n',
  color: '#3b82f6',
  icon: 'folder',
  created_at: T,
  updated_at: T,
  deleted_at: null,
  ...over,
});
const ids = (links: Link[]) => links.map((l) => l.id);

describe('queryLinks filtering', () => {
  const a = link({ id: 'a', title: 'React docs', tags: ['js', 'ui'], category_id: 'c1', created_at: '2026-01-03T00:00:00.000Z' });
  const b = link({
    id: 'b',
    title: 'Rust book',
    notes: 'Systems programming',
    category_id: 'c2',
    is_favorite: true,
    created_at: '2026-01-02T00:00:00.000Z',
  });
  const c = link({ id: 'c', title: 'Old news', is_archived: true, is_favorite: true });
  const d = link({ id: 'd', title: 'Gone', deleted_at: '2026-01-04T00:00:00.000Z' });
  const all = [c, a, d, b];

  it('hides archived and deleted links in the default view, newest first', () => {
    expect(ids(queryLinks(all))).toEqual(['a', 'b']);
  });
  it('favorites view shows non-archived favorites', () => {
    expect(ids(queryLinks(all, { view: 'favorites' }))).toEqual(['b']);
  });
  it('archive view shows only archived links', () => {
    expect(ids(queryLinks(all, { view: 'archive' }))).toEqual(['c']);
  });
  it('filters by category', () => {
    expect(ids(queryLinks(all, { categoryId: 'c2' }))).toEqual(['b']);
    expect(ids(queryLinks(all, { categoryId: null }))).toEqual(['a', 'b']);
  });
  it('requires every search term to match, case-insensitively, across fields', () => {
    expect(ids(queryLinks(all, { search: 'SYSTEMS rust' }))).toEqual(['b']);
    expect(ids(queryLinks(all, { search: '#js' }))).toEqual(['a']);
    expect(ids(queryLinks(all, { search: '  ' }))).toEqual(['a', 'b']);
    expect(queryLinks(all, { search: 'react rust' })).toEqual([]);
  });
  it('searches custom title, description, and url too', () => {
    const x = link({ id: 'x', custom_title: 'Mine', description: 'A deep dive', url: 'https://deep.dev/post' });
    expect(ids(queryLinks([x, a], { search: 'mine dive' }))).toEqual(['x']);
    expect(ids(queryLinks([x, a], { search: 'deep.dev' }))).toEqual(['x']);
  });
});

describe('queryLinks sorting', () => {
  const x = link({ id: 'x', title: 'banana', visit_count: 3, created_at: '2026-01-02T00:00:00.000Z' });
  const y = link({ id: 'y', title: 'Apple', visit_count: 2, created_at: '2026-01-01T00:00:00.000Z' });
  const z = link({ id: 'z', title: 'cherry', custom_title: 'Avocado', visit_count: 2, created_at: '2026-01-03T00:00:00.000Z' });
  const all = [x, y, z];

  it('sorts newest and oldest', () => {
    expect(ids(queryLinks(all, { sort: 'newest' }))).toEqual(['z', 'x', 'y']);
    expect(ids(queryLinks(all, { sort: 'oldest' }))).toEqual(['y', 'x', 'z']);
  });
  it('sorts alphabetically by display title, ignoring case', () => {
    expect(ids(queryLinks(all, { sort: 'alpha' }))).toEqual(['y', 'z', 'x']);
  });
  it('sorts by visits, breaking ties by newest', () => {
    expect(ids(queryLinks(all, { sort: 'visits' }))).toEqual(['x', 'z', 'y']);
  });
  it('compares timestamps as instants, not strings', () => {
    const p = link({ id: 'p', created_at: '2026-01-02T10:00:00+02:00' });
    const q = link({ id: 'q', created_at: '2026-01-02T09:00:00.000Z' });
    expect(ids(queryLinks([p, q]))).toEqual(['q', 'p']);
  });
  it('does not mutate the input array', () => {
    const input = [y, x];
    queryLinks(input, { sort: 'alpha' });
    expect(ids(input)).toEqual(['y', 'x']);
    queryLinks(input);
    expect(ids(input)).toEqual(['y', 'x']);
  });
});

describe('findByUrl', () => {
  const saved = link({ id: 's', url: 'https://a.io/x', url_key: 'a.io/x' });
  const gone = link({ id: 'g', url: 'https://b.io/', url_key: 'b.io', deleted_at: T });
  it('matches on the dedupe key', () => {
    expect(findByUrl([saved, gone], 'http://www.a.io/x/?utm_source=t')?.id).toBe('s');
  });
  it('ignores deleted links and invalid input', () => {
    expect(findByUrl([saved, gone], 'https://b.io')).toBeUndefined();
    expect(findByUrl([saved], 'not a url')).toBeUndefined();
  });
});

describe('activeCategories / countByCategory', () => {
  it('drops deleted categories and sorts by name', () => {
    const list = [cat({ id: '2', name: 'work' }), cat({ id: '1', name: 'Art' }), cat({ id: '3', name: 'Zed', deleted_at: T })];
    expect(activeCategories(list).map((c) => c.id)).toEqual(['1', '2']);
  });
  it('counts visible links per category', () => {
    const links = [
      link({ category_id: 'c1' }),
      link({ category_id: 'c1' }),
      link({ category_id: 'c2', is_archived: true }),
      link({ category_id: 'c2', deleted_at: T }),
      link({ category_id: null }),
    ];
    expect(countByCategory(links)).toEqual({ c1: 2 });
  });
});
