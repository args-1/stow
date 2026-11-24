import { RemoteError, type Link } from '@stow/core';
import { makeLink } from '@stow/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  handleMenuClick,
  SAVE_LINK_ITEM,
  SAVE_PAGE_ITEM,
  SETUP_MESSAGE,
  SIGN_IN_MESSAGE,
  type MenuDeps,
  type MenuServices,
} from './context-menu';
import { OFFLINE_MESSAGE } from './save';

const NOW = '2026-02-01T00:00:00.000Z';
const tab = { id: 7, title: 'The page', favIconUrl: 'https://example.com/icon.png' };
const savePage = { menuItemId: SAVE_PAGE_ITEM, pageUrl: 'https://example.com/page' };
const ok = (title: string) => ({ text: '✓', color: '#059669', title });
const fail = (title: string) => ({ text: '✕', color: '#dc2626', title });

function setup({ saved = [] as Link[], signedIn = true } = {}) {
  const rows = new Map(saved.map((link) => [link.id, link]));
  const server = {
    findLinkByUrlKey: vi.fn(
      async (urlKey: string) => [...rows.values()].find((l) => l.url_key === urlKey && !l.deleted_at) ?? null,
    ),
    upsertLink: vi.fn(async (row: Link) => {
      rows.set(row.id, row);
    }),
  };
  const fetchMetadata = vi.fn<MenuServices['fetchMetadata']>(async () => null);
  const services: MenuServices = {
    server,
    fetchMetadata,
    clock: { now: () => NOW, id: () => 'new-id' },
    hasSession: async () => signedIn,
  };
  const deps = {
    services,
    describePage: vi.fn<MenuDeps['describePage']>(async () => 'About the page'),
    flash: vi.fn<MenuDeps['flash']>(),
  };
  return { deps, server, fetchMetadata, rows };
}

describe('handleMenuClick', () => {
  it('saves the page with its tab title, favicon and description, and no category', async () => {
    const { deps, fetchMetadata, rows } = setup();
    await handleMenuClick(deps, savePage, tab);
    expect(deps.describePage).toHaveBeenCalledWith(7);
    expect(rows.get('new-id')).toMatchObject({
      url: 'https://example.com/page',
      title: 'The page',
      description: 'About the page',
      favicon_url: 'https://example.com/icon.png',
      category_id: null,
    });
    expect(deps.flash).toHaveBeenCalledExactlyOnceWith(ok('Saved to Stow'));
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('saves a link by its URL, shows the result, then fills in the metadata', async () => {
    const { deps, fetchMetadata, rows } = setup();
    fetchMetadata.mockResolvedValue({
      title: 'A post',
      description: 'About the post',
      faviconUrl: 'https://example.org/icon.png',
    });
    await handleMenuClick(deps, { ...savePage, menuItemId: SAVE_LINK_ITEM, linkUrl: 'https://example.org/post' }, tab);
    expect(deps.describePage).not.toHaveBeenCalled();
    expect(deps.flash).toHaveBeenCalledExactlyOnceWith(ok('Saved to Stow'));
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.org/post');
    expect(deps.flash.mock.invocationCallOrder[0]).toBeLessThan(fetchMetadata.mock.invocationCallOrder[0]);
    expect(rows.get('new-id')).toMatchObject({
      url: 'https://example.org/post',
      title: 'A post',
      description: 'About the post',
      favicon_url: 'https://example.org/icon.png',
    });
  });

  it('reports a page that is already saved without saving it again', async () => {
    const { deps, server } = setup({ saved: [makeLink({ url: 'https://example.com/page' })] });
    await handleMenuClick(deps, { ...savePage, pageUrl: 'https://example.com/page#comments' }, tab);
    expect(deps.flash).toHaveBeenCalledExactlyOnceWith(ok('Already in Stow'));
    expect(server.upsertLink).not.toHaveBeenCalled();
  });

  it('asks for setup or sign-in before reading the page or calling the server', async () => {
    const unconfigured = setup();
    await handleMenuClick({ ...unconfigured.deps, services: null }, savePage, tab);
    expect(unconfigured.deps.flash).toHaveBeenCalledExactlyOnceWith(fail(SETUP_MESSAGE));
    const signedOut = setup({ signedIn: false });
    await handleMenuClick(signedOut.deps, savePage, tab);
    expect(signedOut.deps.flash).toHaveBeenCalledExactlyOnceWith(fail(SIGN_IN_MESSAGE));
    for (const { deps, server } of [unconfigured, signedOut]) {
      expect(deps.describePage).not.toHaveBeenCalled();
      expect(server.findLinkByUrlKey).not.toHaveBeenCalled();
    }
  });

  it('shows invalid URLs and server errors as a ✕ badge', async () => {
    const { deps, server } = setup();
    await handleMenuClick(deps, { menuItemId: SAVE_LINK_ITEM, linkUrl: 'mailto:me@example.com' });
    expect(deps.flash).toHaveBeenLastCalledWith(fail('Enter a valid http(s) URL'));
    server.findLinkByUrlKey.mockRejectedValue(new RemoteError('find link: Failed to fetch', 0));
    await handleMenuClick(deps, { menuItemId: SAVE_LINK_ITEM, linkUrl: 'https://example.org/post' });
    expect(deps.flash).toHaveBeenLastCalledWith(fail(OFFLINE_MESSAGE));
  });

  it('ignores unknown menu items and clicks without a URL', async () => {
    const { deps } = setup();
    await handleMenuClick(deps, { ...savePage, menuItemId: 'something-else' }, tab);
    await handleMenuClick(deps, { menuItemId: SAVE_LINK_ITEM }, tab);
    expect(deps.flash).not.toHaveBeenCalled();
  });
});
