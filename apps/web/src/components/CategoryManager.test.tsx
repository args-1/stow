import { makeCategory, makeLink } from '@stow/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CategoryManager, type CategoryActions } from './CategoryManager';

const food = makeCategory({ id: 'cat-food', name: 'Food', color: '#ef4444', icon: 'heart' });
const travel = makeCategory({ id: 'cat-travel', name: 'Travel', color: '#3b82f6', icon: 'plane' });
const old = makeCategory({ id: 'cat-old', name: 'Old', deleted_at: '2026-01-05T00:00:00.000Z' });
const links = [
  makeLink({ id: 'a', category_id: 'cat-food' }),
  makeLink({ id: 'b', category_id: 'cat-food' }),
  makeLink({ id: 'c', category_id: 'cat-travel' }),
  makeLink({ id: 'd', category_id: 'cat-travel', is_archived: true }),
];

let actions: {
  addCategory: Mock<CategoryActions['addCategory']>;
  editCategory: Mock<CategoryActions['editCategory']>;
  deleteCategory: Mock<CategoryActions['deleteCategory']>;
};

beforeEach(() => {
  actions = {
    addCategory: vi.fn(async (input) => ({ ok: true as const, value: makeCategory({ id: 'new', ...input }) })),
    editCategory: vi.fn(async (id, input) => ({ ok: true as const, value: makeCategory({ id, ...input }) })),
    deleteCategory: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const radio = (scope: ReturnType<typeof within>, name: string) => scope.getByRole('radio', { name }) as HTMLInputElement;
const newForm = () => within(screen.getByRole('form', { name: 'New category' }));

describe('CategoryManager', () => {
  it('lists active categories by name with their link counts', () => {
    render(<CategoryManager categories={[travel, food, old]} links={links} actions={actions} />);

    const rows = within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Food')).toBeTruthy();
    expect(within(rows[0]!).getByText('2 links')).toBeTruthy();
    expect(within(rows[1]!).getByText('Travel')).toBeTruthy();
    expect(within(rows[1]!).getByText('1 link')).toBeTruthy();
    expect(rows[0]!.querySelector('svg.lucide-heart')).not.toBeNull();
    expect(rows[1]!.querySelector('svg.lucide-plane')).not.toBeNull();
    expect(screen.queryByText('Old')).toBeNull();
  });

  it('adds a category with the chosen color and icon, then resets the form', async () => {
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);
    expect(radio(newForm(), 'Orange').checked).toBe(true);
    expect(radio(newForm(), 'Folder').checked).toBe(true);

    fireEvent.change(newForm().getByLabelText('Name'), { target: { value: 'Books' } });
    fireEvent.click(radio(newForm(), 'Teal'));
    fireEvent.click(radio(newForm(), 'Briefcase'));
    fireEvent.click(newForm().getByRole('button', { name: 'Add category' }));

    await waitFor(() => expect((newForm().getByLabelText('Name') as HTMLInputElement).value).toBe(''));
    expect(actions.addCategory).toHaveBeenCalledWith({ name: 'Books', color: '#14b8a6', icon: 'briefcase' });
    // Red and teal are now taken, so the next suggestion is orange again.
    expect(radio(newForm(), 'Orange').checked).toBe(true);
    expect(radio(newForm(), 'Folder').checked).toBe(true);
  });

  it('shows a rejected category inline and keeps the input', async () => {
    actions.addCategory.mockResolvedValueOnce({ ok: false, error: 'A category with that name already exists' });
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);

    fireEvent.change(newForm().getByLabelText('Name'), { target: { value: 'food' } });
    fireEvent.click(newForm().getByRole('button', { name: 'Add category' }));

    expect((await newForm().findByRole('alert')).textContent).toBe('A category with that name already exists');
    expect((newForm().getByLabelText('Name') as HTMLInputElement).value).toBe('food');
  });

  it('renames, recolors and changes the icon of a category', async () => {
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Food' }));

    const form = within(screen.getByRole('form', { name: 'Edit Food' }));
    expect(radio(form, 'Red').checked).toBe(true);
    expect(radio(form, 'Heart').checked).toBe(true);
    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Groceries' } });
    fireEvent.click(radio(form, 'Green'));
    fireEvent.click(radio(form, 'Coffee'));
    fireEvent.click(form.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Food' })).toBeNull());
    expect(actions.editCategory).toHaveBeenCalledWith('cat-food', { name: 'Groceries', color: '#22c55e', icon: 'coffee' });
  });

  it('edits a category whose icon this build does not know as folder', async () => {
    const odd = makeCategory({ id: 'cat-odd', name: 'Odd', color: '#ef4444', icon: 'unicorn' });
    render(<CategoryManager categories={[odd]} links={[]} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Odd' }));

    const form = within(screen.getByRole('form', { name: 'Edit Odd' }));
    expect(radio(form, 'Folder').checked).toBe(true);
    fireEvent.click(form.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Odd' })).toBeNull());
    expect(actions.editCategory).toHaveBeenCalledWith('cat-odd', { name: 'Odd', color: '#ef4444', icon: 'folder' });
  });

  it('deletes a category only after confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Food' }));
    expect(confirm).toHaveBeenCalledWith('Delete "Food"? Its links will stay saved, without a category.');
    expect(actions.deleteCategory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Food' }));
    expect(actions.deleteCategory).toHaveBeenCalledWith('cat-food');
  });
});
