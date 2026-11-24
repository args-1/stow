import { RemoteError, type Link, type ParsedLinkInput } from '@linkstash/core';
import { makeLink } from '@linkstash/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteLink,
  describeError,
  enrichLink,
  OFFLINE_MESSAGE,
  patchLink,
  saveLink,
  SESSION_EXPIRED_MESSAGE,
  type SaveDeps,
} from './save';

const NOW = '2026-02-01T00:00:00.000Z';

function setup(saved: Link[] = []) {
  const rows = new Map(saved.map((link) => [link.id, link]));
  const server = {
    findLinkByUrlKey: vi.fn(
      async (urlKey: string) => [...rows.values()].find((l) => l.url_key === urlKey && !l.deleted_at) ?? null,
    ),
    upsertLink: vi.fn(async (row: Link) => {
      rows.set(row.id, row);
    }),
  };
  const fetchMetadata = vi.fn<SaveDeps['fetchMetadata']>(async () => null);
  const deps: SaveDeps = { server, fetchMetadata, clock: { now: () => NOW, id: () => 'new-id' } };
  return { deps, server, fetchMetadata, rows };
}

function input(over: Partial<ParsedLinkInput> = {}): ParsedLinkInput {
  return {
    url: 'https://example.com/article',
    customTitle: null,
    notes: null,
    tags: [],
    categoryId: null,
    title: 'An article',
    description: null,
    faviconUrl: null,
    ...over,
  };
}

describe('saveLink', () => {
  it('saves a new link to the server', async () => {
    const { deps, rows } = setup();
    const result = await saveLink(deps, input({ tags: ['news'] }));
    expect(result.status).toBe('saved');
    expect(result.link).toMatchObject({
      id: 'new-id',
      url: 'https://example.com/article',
      url_key: 'example.com/article',
      title: 'An article',
      tags: ['news'],
      created_at: NOW,
    });
    expect(rows.get('new-id')).toEqual(result.link);
  });

  it('returns the saved link instead of saving the same page twice', async () => {
    const existing = makeLink({ url: 'https://www.example.com/article/' });
    const { deps, server } = setup([existing]);
    const result = await saveLink(deps, input({ url: 'https://example.com/article?utm_source=x#top' }));
    expect(result).toEqual({ status: 'duplicate', link: existing });
    expect(server.upsertLink).not.toHaveBeenCalled();
  });
});

describe('patchLink and deleteLink', () => {
  it('patchLink writes the changed link and returns it', async () => {
    const link = makeLink();
    const { deps, rows } = setup([link]);
    const next = await patchLink(deps, link, { is_favorite: true });
    expect(next).toEqual({ ...link, is_favorite: true, updated_at: NOW });
    expect(rows.get(link.id)).toEqual(next);
  });

  it('deleteLink writes a tombstone', async () => {
    const link = makeLink();
    const { deps, rows } = setup([link]);
    await deleteLink(deps, link);
    expect(rows.get(link.id)).toEqual({ ...link, deleted_at: NOW, updated_at: NOW });
  });
});

describe('enrichLink', () => {
  const bare = () => makeLink({ url: 'https://example.com/a', title: 'example.com' });

  it('fills in the metadata the link lacks and saves it', async () => {
    const link = bare();
    const { deps, fetchMetadata, rows } = setup([link]);
    fetchMetadata.mockResolvedValue({
      title: 'A page',
      description: 'About it',
      faviconUrl: 'https://example.com/icon.png',
    });
    const next = await enrichLink(deps, link);
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.com/a');
    expect(next).toEqual({
      ...link,
      title: 'A page',
      description: 'About it',
      favicon_url: 'https://example.com/icon.png',
      updated_at: NOW,
    });
    expect(rows.get(link.id)).toEqual(next);
  });

  it('does not fetch for a link that already has its metadata', async () => {
    const link = makeLink({ description: 'About it', favicon_url: 'https://example.com/icon.png' });
    const { deps, fetchMetadata } = setup([link]);
    expect(await enrichLink(deps, link)).toBe(link);
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('returns the link unchanged when there is no metadata or the save fails', async () => {
    const link = bare();
    const { deps, fetchMetadata, server } = setup([link]);
    expect(await enrichLink(deps, link)).toBe(link);
    fetchMetadata.mockResolvedValue({ description: 'About it' });
    server.upsertLink.mockRejectedValue(new RemoteError('save link: boom', 500));
    expect(await enrichLink(deps, link)).toBe(link);
  });
});

describe('describeError', () => {
  it('explains offline and expired-session errors and passes other messages through', () => {
    expect(describeError(new RemoteError('find link: Failed to fetch', 0))).toBe(OFFLINE_MESSAGE);
    expect(describeError(new RemoteError('find link: JWT expired', 401))).toBe(SESSION_EXPIRED_MESSAGE);
    expect(describeError(new RemoteError('save link: bad row', 400))).toBe('save link: bad row');
    expect(describeError(new Error('nope'))).toBe('nope');
    expect(describeError('plain')).toBe('plain');
  });
});
