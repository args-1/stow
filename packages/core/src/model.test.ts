import { describe, expect, it } from 'vitest';
import {
  cleanMetadata,
  createCategory,
  createLink,
  displayTitle,
  editPatch,
  metadataPatch,
  needsMetadata,
  nextCategoryColor,
  normalizeTags,
  parseCategoryInput,
  parseLinkInput,
  parseTagString,
  updateCategory,
  updateLink,
  type Clock,
  type LinkInput,
} from './model';
import { CATEGORY_COLORS } from './schema';

const T0 = '2026-01-01T00:00:00.000Z';
const clock = (now = T0, id = 'id-1'): Clock => ({ now: () => now, id: () => id });

function parsed(input: LinkInput) {
  const r = parseLinkInput(input);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('normalizeTags / parseTagString', () => {
  it('trims, lowercases, strips #, hyphenates spaces, and dedupes', () => {
    expect(normalizeTags([' Read Later ', '#JS', 'js', '', '  '])).toEqual(['read-later', 'js']);
  });
  it('splits a comma-separated string', () => {
    expect(parseTagString('a, B ,#c,,a')).toEqual(['a', 'b', 'c']);
  });
});

describe('parseLinkInput', () => {
  it('normalizes the URL and fills defaults', () => {
    expect(parsed({ url: 'example.com' })).toEqual({
      url: 'https://example.com/',
      customTitle: null,
      notes: null,
      tags: [],
      categoryId: null,
      title: null,
      description: null,
      faviconUrl: null,
    });
  });
  it('trims text, turns blanks into null, and normalizes tags', () => {
    const v = parsed({ url: 'https://a.io', customTitle: '  Mine ', notes: '   ', tags: ['X', 'x'], categoryId: '' });
    expect(v).toMatchObject({ customTitle: 'Mine', notes: null, tags: ['x'], categoryId: null });
  });
  it('rejects invalid URLs', () => {
    expect(parseLinkInput({ url: 'not a url' })).toEqual({ ok: false, error: 'Enter a valid http(s) URL' });
  });
  it('rejects notes that are too long', () => {
    expect(parseLinkInput({ url: 'https://a.io', notes: 'x'.repeat(5001) }).ok).toBe(false);
  });
  it('rejects more than 20 tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(parseLinkInput({ url: 'https://a.io', tags })).toEqual({ ok: false, error: 'Use at most 20 tags' });
  });
  it('clips metadata and drops non-http favicons', () => {
    const v = parsed({
      url: 'https://a.io',
      title: ` ${'t'.repeat(400)} `,
      description: 'a\n   b',
      faviconUrl: 'data:image/png;base64,xx',
    });
    expect(v.title).toHaveLength(300);
    expect(v.description).toBe('a b');
    expect(v.faviconUrl).toBeNull();
  });
});

describe('cleanMetadata', () => {
  it('keeps http favicons and nulls empty strings', () => {
    expect(cleanMetadata({ title: '  ', description: null, faviconUrl: 'https://a.io/f.ico' })).toEqual({
      title: null,
      description: null,
      faviconUrl: 'https://a.io/f.ico',
    });
  });
});

describe('createLink / updateLink / editPatch / displayTitle', () => {
  it('creates a link with a url_key and a hostname fallback title', () => {
    expect(createLink(parsed({ url: 'https://www.example.com/a/', tags: ['x'] }), clock())).toEqual({
      id: 'id-1',
      url: 'https://www.example.com/a/',
      url_key: 'example.com/a',
      title: 'example.com',
      custom_title: null,
      description: null,
      favicon_url: null,
      notes: null,
      tags: ['x'],
      category_id: null,
      is_favorite: false,
      is_archived: false,
      visit_count: 0,
      last_visited_at: null,
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
    });
  });
  it('uses the fetched page title when present', () => {
    expect(createLink(parsed({ url: 'https://a.io', title: 'Page' }), clock()).title).toBe('Page');
  });
  it('updateLink bumps updated_at and recomputes url_key when the URL changes', () => {
    const link = createLink(parsed({ url: 'https://a.io/x' }), clock());
    const next = updateLink(link, { url: 'https://b.io/y', is_favorite: true }, clock('2026-02-01T00:00:00.000Z'));
    expect(next).toMatchObject({
      url: 'https://b.io/y',
      url_key: 'b.io/y',
      is_favorite: true,
      updated_at: '2026-02-01T00:00:00.000Z',
    });
    expect(link.url_key).toBe('a.io/x');
  });
  it('editPatch maps form fields onto link columns', () => {
    expect(editPatch(parsed({ url: 'a.io', customTitle: 'T', notes: 'n', tags: ['t'], categoryId: 'c1' }))).toEqual({
      url: 'https://a.io/',
      custom_title: 'T',
      notes: 'n',
      tags: ['t'],
      category_id: 'c1',
    });
  });
  it('displayTitle prefers custom title, then title, then hostname', () => {
    expect(displayTitle({ custom_title: 'C', title: 'T', url: 'https://a.io' })).toBe('C');
    expect(displayTitle({ custom_title: null, title: 'T', url: 'https://a.io' })).toBe('T');
    expect(displayTitle({ custom_title: null, title: '', url: 'https://www.a.io' })).toBe('a.io');
  });
});

describe('metadataPatch / needsMetadata', () => {
  const bare = () => createLink(parsed({ url: 'https://www.a.io/x' }), clock());
  const full = () =>
    createLink(
      parsed({ url: 'https://a.io', title: 'Mine', description: 'Mine too', faviconUrl: 'https://a.io/1.png' }),
      clock(),
    );

  it('fills the placeholder title, a missing description and a missing favicon', () => {
    expect(metadataPatch(bare(), { title: ' Page ', description: 'About', faviconUrl: 'https://a.io/f.png' })).toEqual({
      title: 'Page',
      description: 'About',
      favicon_url: 'https://a.io/f.png',
    });
  });
  it('never overwrites values the link already has', () => {
    expect(metadataPatch(full(), { title: 'New', description: 'New', faviconUrl: 'https://a.io/2.png' })).toEqual({});
  });
  it('needsMetadata is false only when title, description and favicon are all filled', () => {
    expect(needsMetadata(bare())).toBe(true);
    expect(needsMetadata(full())).toBe(false);
  });
});

describe('categories', () => {
  it('validates name and color', () => {
    expect(parseCategoryInput({ name: '  Work ', color: '#3B82F6' })).toEqual({
      ok: true,
      value: { name: 'Work', color: '#3b82f6' },
    });
    expect(parseCategoryInput({ name: ' ', color: '#3b82f6' })).toEqual({ ok: false, error: 'Name is required' });
    expect(parseCategoryInput({ name: 'x'.repeat(51), color: '#3b82f6' }).ok).toBe(false);
    expect(parseCategoryInput({ name: 'Work', color: 'blue' })).toEqual({ ok: false, error: 'Pick a color' });
  });
  it('creates and updates categories', () => {
    const c = createCategory({ name: 'Work', color: '#3b82f6' }, clock());
    expect(c).toEqual({ id: 'id-1', name: 'Work', color: '#3b82f6', created_at: T0, updated_at: T0, deleted_at: null });
    expect(updateCategory(c, { name: 'Jobs' }, clock('2026-03-01T00:00:00.000Z'))).toMatchObject({
      name: 'Jobs',
      updated_at: '2026-03-01T00:00:00.000Z',
    });
  });
  it('nextCategoryColor picks the first unused palette color', () => {
    expect(nextCategoryColor([])).toBe(CATEGORY_COLORS[0]);
    const c = createCategory({ name: 'A', color: CATEGORY_COLORS[0] }, clock());
    expect(nextCategoryColor([c])).toBe(CATEGORY_COLORS[1]);
  });
});
