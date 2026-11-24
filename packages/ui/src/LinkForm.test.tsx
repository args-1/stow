import { makeCategory } from '@linkstash/core/testing';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkForm } from './LinkForm';

const reading = makeCategory({ id: 'cat-reading', name: 'Reading' });
const archived = makeCategory({ id: 'cat-old', name: 'Old', deleted_at: '2026-01-02T00:00:00.000Z' });
const recipes = makeCategory({ id: 'cat-recipes', name: 'Recipes' });

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('LinkForm', () => {
  it('submits normalized input', async () => {
    const onSubmit = vi.fn();
    render(<LinkForm categories={[reading, recipes]} onSubmit={onSubmit} />);

    type('URL', 'example.com/a');
    type('Title', '  My title ');
    type('Category', 'cat-recipes');
    type('Tags', 'Read, #Later, read');
    type('Notes', 'remember this');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      url: 'https://example.com/a',
      customTitle: 'My title',
      categoryId: 'cat-recipes',
      tags: ['read', 'later'],
      notes: 'remember this',
      title: null,
      description: null,
      faviconUrl: null,
    });
  });

  it('shows a validation error and does not submit', () => {
    const onSubmit = vi.fn();
    render(<LinkForm categories={[]} onSubmit={onSubmit} />);

    type('URL', 'ftp://example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid http(s) URL');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills values and merges page metadata', async () => {
    const onSubmit = vi.fn();
    render(
      <LinkForm
        categories={[reading]}
        initial={{ url: 'https://news.example/story', categoryId: 'cat-reading', tags: 'news' }}
        metadata={{ title: 'Big story', description: 'All about it', faviconUrl: 'https://news.example/f.ico' }}
        urlReadOnly
        submitLabel="Save page"
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByLabelText('URL') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('cat-reading');
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://news.example/story',
      customTitle: null,
      categoryId: 'cat-reading',
      tags: ['news'],
      title: 'Big story',
      description: 'All about it',
      faviconUrl: 'https://news.example/f.ico',
    });
  });

  it('lists only active categories and drops a deleted one on submit', async () => {
    const onSubmit = vi.fn();
    render(
      <LinkForm
        categories={[recipes, archived, reading]}
        initial={{ url: 'https://a.example/', categoryId: 'cat-old' }}
        onSubmit={onSubmit}
      />,
    );

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['No category', 'Reading', 'Recipes']);
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ categoryId: null });
  });

  it('shows an error thrown by onSubmit and lets the user retry', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(undefined);
    render(<LinkForm categories={[]} initial={{ url: 'https://a.example/' }} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Network down');

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('disables saving while busy and offers cancel', () => {
    const onCancel = vi.fn();
    render(<LinkForm categories={[]} busy onSubmit={vi.fn()} onCancel={onCancel} />);

    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
