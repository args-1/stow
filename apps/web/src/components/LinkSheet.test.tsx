import { MemoryLocalStore, SyncEngine } from '@stow/core';
import { FakeRemote, makeCategory, makeLink } from '@stow/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createActions, type Actions } from '../actions';
import { dismiss, getToasts } from '../toast';
import { LinkSheet, type LinkSheetTarget } from './LinkSheet';
import { Toaster } from './Toaster';

const food = makeCategory({ id: 'cat-food', name: 'Food' });

let store: MemoryLocalStore;
let actions: Actions;
let requestSync: Mock<() => void>;
let onClose: Mock<() => void>;

beforeEach(() => {
  store = new MemoryLocalStore();
  requestSync = vi.fn();
  onClose = vi.fn();
  actions = createActions({
    engine: new SyncEngine(store, new FakeRemote()),
    store,
    requestSync,
    fetchMetadata: async () => null,
  });
});

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
});

function renderSheet(target: LinkSheetTarget) {
  return render(
    <>
      <LinkSheet target={target} categories={[food]} actions={actions} onClose={onClose} />
      <Toaster />
    </>,
  );
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('LinkSheet', () => {
  it('adds a link and queues it for sync', async () => {
    renderSheet({ mode: 'add' });
    expect(screen.getByRole('dialog', { name: 'Add link' })).toBeTruthy();

    type('URL', 'example.com/post');
    type('Category', 'cat-food');
    type('Tags', 'Read later, news');
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const [link] = await store.listLinks();
    expect(link).toMatchObject({
      url: 'https://example.com/post',
      title: 'example.com',
      category_id: 'cat-food',
      tags: ['read-later', 'news'],
    });
    expect((await store.peekOutbox()).map((e) => e.mutation)).toEqual([{ type: 'upsertLink', row: link }]);
    expect(requestSync).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Link saved');
  });

  it('prefills a shared link and stores the shared title as the page title', async () => {
    renderSheet({ mode: 'add', url: 'https://example.com/shared', title: 'Shared headline' });
    expect(input('URL').value).toBe('https://example.com/shared');

    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect((await store.listLinks())[0]).toMatchObject({ title: 'Shared headline', custom_title: null });
  });

  it('switches to editing when the link is already saved', async () => {
    await store.apply({ links: [makeLink({ id: 'old', url: 'https://example.com/post', notes: 'Keep this' })] });
    renderSheet({ mode: 'add', url: 'https://example.com/post' });

    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    expect(await screen.findByRole('dialog', { name: 'Edit link' })).toBeTruthy();
    expect(input('Notes').value).toBe('Keep this');
    expect(screen.getByRole('status').textContent).toContain('already saved');
    expect(onClose).not.toHaveBeenCalled();
    expect(await store.peekOutbox()).toEqual([]);
  });

  it('edits a link', async () => {
    const link = makeLink({ id: 'l1', url: 'https://example.com/a', title: 'Page title', tags: ['one', 'two'] });
    await store.apply({ links: [link] });
    renderSheet({ mode: 'edit', link });
    expect(input('Title').placeholder).toBe('Page title');
    expect(input('Tags').value).toBe('one, two');

    type('Title', 'My title');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(await store.getLink('l1')).toMatchObject({ custom_title: 'My title', title: 'Page title', tags: ['one', 'two'] });
  });

  it('refuses to point a link at a page that is already saved', async () => {
    const a = makeLink({ id: 'a', url: 'https://example.com/a' });
    await store.apply({ links: [a, makeLink({ id: 'b', url: 'https://example.com/b' })] });
    renderSheet({ mode: 'edit', link: a });

    type('URL', 'https://example.com/b');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Another saved link already points to this page.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape and gives focus back', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderSheet({ mode: 'add' });
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
