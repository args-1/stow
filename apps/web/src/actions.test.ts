import { MemoryLocalStore, SyncEngine, type Clock, type PageMetadataInput, type ParsedLinkInput } from '@stow/core';
import { FakeRemote } from '@stow/core/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createActions, type Actions, type SaveLinkResult } from './actions';

function testClock(): Clock {
  let seconds = 0;
  let ids = 0;
  return {
    now: () => new Date(Date.UTC(2026, 1, 1, 0, 0, ++seconds)).toISOString(),
    id: () => `new-${++ids}`,
  };
}

const input = (over: Partial<ParsedLinkInput> = {}): ParsedLinkInput => ({
  url: 'https://example.com/article',
  customTitle: null,
  notes: null,
  tags: [],
  categoryId: null,
  title: null,
  description: null,
  faviconUrl: null,
  ...over,
});

function saved(result: SaveLinkResult) {
  if (result.status !== 'saved') throw new Error(`expected a saved link, got ${result.status}`);
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let local: MemoryLocalStore;
let requestSync: Mock<() => void>;
let fetchMetadata: Mock<(url: string) => Promise<PageMetadataInput | null>>;
let actions: Actions;

const outboxTypes = async () => (await local.peekOutbox()).map((entry) => entry.mutation.type);

beforeEach(() => {
  local = new MemoryLocalStore();
  requestSync = vi.fn<() => void>();
  fetchMetadata = vi.fn<(url: string) => Promise<PageMetadataInput | null>>(async () => null);
  actions = createActions({
    engine: new SyncEngine(local, new FakeRemote()),
    store: local,
    requestSync,
    fetchMetadata,
    clock: testClock(),
  });
});

describe('addLink', () => {
  it('saves a new link right away, then fills in fetched metadata', async () => {
    const meta = deferred<PageMetadataInput | null>();
    fetchMetadata.mockReturnValue(meta.promise);

    const result = saved(await actions.addLink(input({ tags: ['news'] })));
    expect(result.link).toMatchObject({ id: 'new-1', title: 'example.com', url_key: 'example.com/article', tags: ['news'] });
    expect(await local.getLink('new-1')).toEqual(result.link);
    expect(await outboxTypes()).toEqual(['upsertLink']);
    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.com/article');

    meta.resolve({ title: '  Example   Article ', description: 'About things', faviconUrl: 'https://example.com/favicon.ico' });
    await result.enrichment;
    expect(await local.getLink('new-1')).toMatchObject({
      title: 'Example Article',
      description: 'About things',
      favicon_url: 'https://example.com/favicon.ico',
    });
    expect(await outboxTypes()).toEqual(['upsertLink', 'upsertLink']);
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('reports a duplicate instead of saving the same page twice', async () => {
    const first = saved(await actions.addLink(input()));
    await first.enrichment;

    const again = await actions.addLink(input({ url: 'http://www.example.com/article/#top' }));
    expect(again).toEqual({ status: 'duplicate', link: first.link });
    expect(await local.listLinks()).toHaveLength(1);
    expect(await outboxTypes()).toEqual(['upsertLink']);
  });

  it('keeps a real title and leaves links deleted before metadata arrives alone', async () => {
    fetchMetadata.mockResolvedValue({ title: 'Fetched', description: 'Fetched description', faviconUrl: null });
    const shared = saved(await actions.addLink(input({ title: 'Shared title' })));
    await shared.enrichment;
    expect(await local.getLink(shared.link.id)).toMatchObject({ title: 'Shared title', description: 'Fetched description' });

    const meta = deferred<PageMetadataInput | null>();
    fetchMetadata.mockReturnValue(meta.promise);
    const gone = saved(await actions.addLink(input({ url: 'https://example.org/' })));
    await actions.deleteLink(gone.link.id);
    meta.resolve({ title: 'Too late' });
    await gone.enrichment;
    expect(await local.getLink(gone.link.id)).toMatchObject({ title: 'example.org' });
  });

  it('does not fetch metadata the input already has', async () => {
    const result = saved(
      await actions.addLink(input({ title: 'T', description: 'D', faviconUrl: 'https://example.com/f.ico' })),
    );
    await result.enrichment;
    expect(fetchMetadata).not.toHaveBeenCalled();
  });
});

describe('editLink', () => {
  it('updates the user fields and keeps metadata when the page is the same', async () => {
    fetchMetadata.mockResolvedValue({ title: 'Article', description: 'D', faviconUrl: null });
    const added = saved(await actions.addLink(input()));
    await added.enrichment;
    fetchMetadata.mockClear();

    const edited = saved(
      await actions.editLink(added.link.id, input({ url: 'https://example.com/article#intro', customTitle: 'Mine', tags: ['a'] })),
    );
    await edited.enrichment;
    expect(await local.getLink(added.link.id)).toMatchObject({
      url: 'https://example.com/article#intro',
      custom_title: 'Mine',
      tags: ['a'],
      title: 'Article',
      description: 'D',
    });
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('re-fetches metadata for a new page, unless that page is already saved', async () => {
    fetchMetadata.mockResolvedValue({ title: 'Old page', description: 'Old', faviconUrl: 'https://example.com/f.ico' });
    const added = saved(await actions.addLink(input()));
    await added.enrichment;
    const other = saved(await actions.addLink(input({ url: 'https://example.net/' })));
    await other.enrichment;

    expect(await actions.editLink(added.link.id, input({ url: 'https://example.net/' }))).toEqual({
      status: 'duplicate',
      link: await local.getLink(other.link.id),
    });

    fetchMetadata.mockResolvedValue({ title: 'New page', description: null, faviconUrl: null });
    const moved = saved(await actions.editLink(added.link.id, input({ url: 'https://example.org/new' })));
    expect(moved.link).toMatchObject({ url_key: 'example.org/new', title: 'example.org', description: null, favicon_url: null });
    await moved.enrichment;
    expect(await local.getLink(added.link.id)).toMatchObject({ title: 'New page' });
  });

  it('refuses to edit a deleted link', async () => {
    const added = saved(await actions.addLink(input()));
    await actions.deleteLink(added.link.id);
    await expect(actions.editLink(added.link.id, input())).rejects.toThrow('This link was deleted');
  });
});

describe('link flags and visits', () => {
  it('toggles favorite and archive, and deletes with undo', async () => {
    const added = saved(await actions.addLink(input()));
    await added.enrichment;
    const id = added.link.id;

    await actions.toggleFavorite(id);
    await actions.toggleArchive(id);
    expect(await local.getLink(id)).toMatchObject({ is_favorite: true, is_archived: true });
    await actions.toggleFavorite(id);
    expect(await local.getLink(id)).toMatchObject({ is_favorite: false });

    await actions.deleteLink(id);
    expect((await local.getLink(id))?.deleted_at).not.toBeNull();
    await actions.restoreLink(id);
    expect((await local.getLink(id))?.deleted_at).toBeNull();

    expect(await outboxTypes()).toEqual(Array(6).fill('upsertLink'));
    expect(requestSync).toHaveBeenCalledTimes(6);
  });

  it('records a visit when a link is opened', async () => {
    const added = saved(await actions.addLink(input()));
    await added.enrichment;

    await actions.openLink(added.link.id);
    const link = await local.getLink(added.link.id);
    expect(link?.visit_count).toBe(1);
    expect(link?.last_visited_at).not.toBeNull();
    expect(await outboxTypes()).toEqual(['upsertLink', 'visit']);
    expect(requestSync).toHaveBeenCalledTimes(2);
  });
});

describe('categories', () => {
  it('creates, renames and deletes categories, rejecting bad or duplicate names', async () => {
    const reading = await actions.addCategory({ name: ' Reading ', color: '#3B82F6', icon: 'book-open' });
    if (!reading.ok) throw new Error(reading.error);
    expect(reading.value).toMatchObject({ name: 'Reading', color: '#3b82f6', icon: 'book-open' });
    expect(await actions.addCategory({ name: 'reading', color: '#ef4444', icon: 'folder' })).toEqual({
      ok: false,
      error: 'A category with that name already exists',
    });
    expect(await actions.addCategory({ name: '  ', color: '#ef4444', icon: 'folder' })).toEqual({
      ok: false,
      error: 'Name is required',
    });

    const work = await actions.addCategory({ name: 'Work', color: '#ef4444', icon: 'briefcase' });
    if (!work.ok) throw new Error(work.error);
    expect(await actions.editCategory(work.value.id, { name: 'READING', color: '#ef4444', icon: 'briefcase' })).toEqual({
      ok: false,
      error: 'A category with that name already exists',
    });
    expect(await actions.editCategory(reading.value.id, { name: 'reading', color: '#22c55e', icon: 'heart' })).toMatchObject({
      ok: true,
      value: { id: reading.value.id, name: 'reading', color: '#22c55e', icon: 'heart' },
    });

    await actions.deleteCategory(reading.value.id);
    expect((await local.getCategory(reading.value.id))?.deleted_at).not.toBeNull();
    expect(await actions.editCategory(reading.value.id, { name: 'X', color: '#3b82f6', icon: 'folder' })).toEqual({
      ok: false,
      error: 'This category was deleted',
    });
    expect(await actions.addCategory({ name: 'Reading', color: '#3b82f6', icon: 'folder' })).toMatchObject({ ok: true });
    expect(await outboxTypes()).toEqual(Array(5).fill('upsertCategory'));
  });
});
