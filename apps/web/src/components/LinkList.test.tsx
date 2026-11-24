import type { LinkQuery } from '@stow/core';
import { makeCategory, makeLink } from '@stow/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { dismiss, getToasts } from '../toast';
import { LinkList, type LinkActions } from './LinkList';
import { Toaster } from './Toaster';

const food = makeCategory({ id: 'cat-food', name: 'Food', color: '#ef4444' });
const gone = makeCategory({ id: 'cat-gone', name: 'Gone', deleted_at: '2026-01-05T00:00:00.000Z' });

const banana = makeLink({
  id: 'banana',
  title: 'Banana bread',
  url: 'https://bake.example/banana',
  tags: ['recipes'],
  category_id: 'cat-food',
  visit_count: 5,
  created_at: '2026-01-03T00:00:00.000Z',
});
const apple = makeLink({
  id: 'apple',
  title: 'Apple pie',
  url: 'https://apple.example/',
  is_favorite: true,
  category_id: 'cat-gone',
  created_at: '2026-01-01T00:00:00.000Z',
});
const cherry = makeLink({ id: 'cherry', title: 'Cherry news', is_archived: true, created_at: '2026-01-02T00:00:00.000Z' });
const removed = makeLink({ id: 'removed', title: 'Removed', deleted_at: '2026-01-04T00:00:00.000Z' });
const links = [banana, apple, cherry, removed];

let actions: Record<keyof LinkActions, Mock<(id: string) => Promise<void>>>;
let onEdit: Mock<(link: unknown) => void>;

beforeEach(() => {
  const action = () => vi.fn<(id: string) => Promise<void>>(async () => undefined);
  actions = {
    openLink: action(),
    toggleFavorite: action(),
    toggleArchive: action(),
    deleteLink: action(),
    restoreLink: action(),
  };
  onEdit = vi.fn();
  // jsdom cannot open new tabs; stop it from trying when a link title is clicked.
  document.addEventListener('click', preventNavigation);
});

afterEach(() => {
  document.removeEventListener('click', preventNavigation);
  for (const t of getToasts()) dismiss(t.id);
});

function preventNavigation(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
}

const list = (query: LinkQuery = {}, items = links) => (
  <>
    <LinkList links={items} categories={[food, gone]} query={query} actions={actions} onEdit={onEdit} />
    <Toaster />
  </>
);

const titles = () => screen.queryAllByRole('link').map((a) => a.textContent);
const card = (title: string) => screen.getByRole('link', { name: title }).closest('li')!;

describe('LinkList', () => {
  it('lists live, unarchived links newest first, with host, tags and active category', () => {
    render(list());
    expect(titles()).toEqual(['Banana bread', 'Apple pie']);

    const bananaCard = within(card('Banana bread'));
    expect(bananaCard.getByText('Food')).toBeTruthy();
    expect(bananaCard.getByText('bake.example')).toBeTruthy();
    expect(bananaCard.getByText('#recipes')).toBeTruthy();
    expect(screen.queryByText('Gone')).toBeNull();
  });

  it('applies search, category, view and sort from the query', () => {
    const { rerender } = render(list({ search: '#recipes' }));
    expect(titles()).toEqual(['Banana bread']);

    rerender(list({ categoryId: 'cat-food' }));
    expect(titles()).toEqual(['Banana bread']);
    rerender(list({ sort: 'alpha' }));
    expect(titles()).toEqual(['Apple pie', 'Banana bread']);
    rerender(list({ sort: 'visits' }));
    expect(titles()).toEqual(['Banana bread', 'Apple pie']);
    rerender(list({ view: 'favorites' }));
    expect(titles()).toEqual(['Apple pie']);
    rerender(list({ view: 'archive' }));
    expect(titles()).toEqual(['Cherry news']);
    expect(within(card('Cherry news')).getByRole('button', { name: 'Unarchive' })).toBeTruthy();
  });

  it('wires the card buttons to the actions', () => {
    render(list());
    fireEvent.click(screen.getByRole('link', { name: 'Banana bread' }));
    expect(actions.openLink).toHaveBeenCalledWith('banana');

    fireEvent.click(within(card('Apple pie')).getByRole('button', { name: 'Favorite', pressed: true }));
    expect(actions.toggleFavorite).toHaveBeenCalledWith('apple');
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Archive' }));
    expect(actions.toggleArchive).toHaveBeenCalledWith('banana');
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(banana);
  });

  it('deletes with an undo toast', async () => {
    render(list());
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Delete' }));
    expect(actions.deleteLink).toHaveBeenCalledWith('banana');

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(actions.restoreLink).toHaveBeenCalledWith('banana');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
  });

  it('reports a failed action in an error toast', async () => {
    actions.toggleFavorite.mockRejectedValueOnce(new Error('Storage is full'));
    render(list());
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Favorite' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Storage is full');
  });

  it('explains an empty list', () => {
    const { rerender } = render(list({}, []));
    expect(screen.getByText(/No links yet/)).toBeTruthy();
    rerender(list({ search: 'zzz' }));
    expect(screen.getByText('No links match these filters.')).toBeTruthy();
  });
});
