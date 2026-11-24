import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismiss, getToasts, toast } from '../toast';
import { Toaster } from './Toaster';

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
});

describe('Toaster', () => {
  it('shows toasts, runs a toast action, and dismisses toasts', () => {
    const run = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.error('Sync failed');
      toast.info('Link deleted', { label: 'Undo', run });
    });
    expect(screen.getByRole('alert').textContent).toContain('Sync failed');
    expect(screen.getByRole('status').textContent).toContain('Link deleted');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText('Link deleted')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
