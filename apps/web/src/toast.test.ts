import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_TOAST_MS, dismiss, getToasts, toast, TOAST_MS, useToasts } from './toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
  vi.useRealTimers();
});

describe('toast', () => {
  it('hides plain toasts after TOAST_MS and toasts with an action after ACTION_TOAST_MS', () => {
    const run = vi.fn();
    toast.info('Saved');
    toast.error('Deleted', { label: 'Undo', run });
    expect(getToasts().map((t) => [t.kind, t.message])).toEqual([
      ['info', 'Saved'],
      ['error', 'Deleted'],
    ]);

    vi.advanceTimersByTime(TOAST_MS);
    expect(getToasts().map((t) => t.message)).toEqual(['Deleted']);
    vi.advanceTimersByTime(ACTION_TOAST_MS - TOAST_MS);
    expect(getToasts()).toEqual([]);
  });

  it('reuses an identical toast on screen, but never merges toasts that carry an action', () => {
    const first = toast.error('Offline');
    expect(toast.error('Offline')).toBe(first);
    toast.info('Deleted', { label: 'Undo', run: vi.fn() });
    toast.info('Deleted', { label: 'Undo', run: vi.fn() });
    expect(getToasts()).toHaveLength(3);

    dismiss(first);
    expect(getToasts().map((t) => t.message)).toEqual(['Deleted', 'Deleted']);
  });

  it('re-renders subscribers when toasts change', () => {
    const { result } = renderHook(() => useToasts());
    expect(result.current).toEqual([]);
    act(() => {
      toast.info('Hello');
    });
    expect(result.current.map((t) => t.message)).toEqual(['Hello']);
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(result.current).toEqual([]);
  });
});
