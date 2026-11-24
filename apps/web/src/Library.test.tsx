import { makeCategory, makeLink } from '@linkstash/core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Library } from './Library';
import { createFakeServices, fakeSession, renderWithServices, type FakeServices } from './test/fakeServices';
import { dismiss, getToasts } from './toast';

let fake: FakeServices;

beforeEach(() => {
  fake = createFakeServices(fakeSession('user-1'));
});

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
  vi.restoreAllMocks();
});

const titles = () =>
  within(screen.getByRole('list', { name: 'Links' }))
    .getAllByRole('link')
    .map((a) => a.textContent);
const viewButton = (name: string) => within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name });

describe('Library', () => {
  it('filters by view, category and search, and sorts', async () => {
    await fake.store.apply({
      categories: [makeCategory({ id: 'cat-food', name: 'Food' }), makeCategory({ id: 'cat-travel', name: 'Travel' })],
      links: [
        makeLink({ title: 'Pasta recipe', category_id: 'cat-food', tags: ['dinner'], created_at: '2026-01-03T00:00:00.000Z' }),
        makeLink({ title: 'Zurich guide', category_id: 'cat-travel', is_favorite: true, created_at: '2026-01-02T00:00:00.000Z' }),
        makeLink({ title: 'Old manual', is_archived: true }),
      ],
    });
    renderWithServices(<Library />, fake.services);

    await screen.findByRole('link', { name: 'Pasta recipe' });
    expect(titles()).toEqual(['Pasta recipe', 'Zurich guide']);

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    expect(titles()).toEqual(['Zurich guide', 'Pasta recipe']);

    fireEvent.click(viewButton('Favorites'));
    expect(titles()).toEqual(['Zurich guide']);
    fireEvent.click(viewButton('All'));

    const food = within(screen.getByRole('group', { name: 'Category filter' })).getByRole('button', { name: /^Food/ });
    fireEvent.click(food);
    expect(food.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual(['Pasta recipe']);
    fireEvent.click(food);
    expect(titles()).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: '#dinner' } });
    expect(titles()).toEqual(['Pasta recipe']);
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: '' } });

    fireEvent.click(viewButton('Archive'));
    expect(titles()).toEqual(['Old manual']);
  });

  it('adds a link and shows it as a pending change', async () => {
    renderWithServices(<Library />, fake.services);
    await screen.findByText(/No links yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const dialog = screen.getByRole('dialog', { name: 'Add link' });
    fireEvent.change(within(dialog).getByLabelText('URL'), { target: { value: 'example.com/new' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save link' }));

    expect(await screen.findByRole('link', { name: 'example.com' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('1 pending')).toBeTruthy();
    expect(fake.scheduler.request).toHaveBeenCalled();
  });

  it('opens a shared link in the add sheet', async () => {
    const onShareOpened = vi.fn();
    renderWithServices(
      <Library share={{ url: 'https://example.com/shared', title: 'Shared page' }} onShareOpened={onShareOpened} />,
      fake.services,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Add link' });
    expect((within(dialog).getByLabelText('URL') as HTMLInputElement).value).toBe('https://example.com/shared');
    expect(onShareOpened).toHaveBeenCalledOnce();
  });

  it('confirms before discarding unsynced changes, then signs out and clears this device', async () => {
    const link = makeLink({ title: 'Unsynced' });
    await fake.store.apply({ links: [link], mutations: [{ type: 'upsertLink', row: link }] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithServices(<Library />, fake.services);
    await screen.findByText('1 pending');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(fake.auth.signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText(/No links yet/);
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(fake.scheduler.stop).toHaveBeenCalled();
    expect(await fake.store.peekOutbox()).toEqual([]);
  });

  it('still confirms when Sign out is clicked before the pending count has loaded', async () => {
    const link = makeLink({ title: 'Unsynced' });
    await fake.store.apply({ links: [link], mutations: [{ type: 'upsertLink', row: link }] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithServices(<Library />, fake.services);
    expect(screen.queryByText('1 pending')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(fake.auth.signOut).not.toHaveBeenCalled();
    expect(await fake.store.peekOutbox()).toHaveLength(1);
  });

  it('manages categories from the filter bar', async () => {
    renderWithServices(<Library />, fake.services);
    await screen.findByText(/No links yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Manage categories' }));
    const dialog = screen.getByRole('dialog', { name: 'Manage categories' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Books' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    await within(dialog).findByText('Books');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    const filter = await screen.findByRole('group', { name: 'Category filter' });
    expect(within(filter).getByRole('button', { name: /^Books/ })).toBeTruthy();
  });
});
