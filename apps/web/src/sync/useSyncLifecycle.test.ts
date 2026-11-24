import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SyncScheduler } from './scheduler';
import { useSyncLifecycle, type SyncLifecycleDeps } from './useSyncLifecycle';

let scheduler: { start: Mock<() => void>; stop: Mock<() => void>; request: Mock<() => void> };
let ensureOwner: Mock<(userId: string) => Promise<boolean>>;
let unsubscribe: Mock<() => void>;
let subscribeChanges: Mock<(userId: string, onChange: () => void) => () => void>;
let deps: SyncLifecycleDeps;

beforeEach(() => {
  scheduler = { start: vi.fn<() => void>(), stop: vi.fn<() => void>(), request: vi.fn<() => void>() };
  ensureOwner = vi.fn<(userId: string) => Promise<boolean>>(async () => false);
  unsubscribe = vi.fn<() => void>();
  subscribeChanges = vi.fn<(userId: string, onChange: () => void) => () => void>(() => unsubscribe);
  deps = { scheduler: scheduler satisfies SyncScheduler, store: { ensureOwner }, subscribeChanges };
});

describe('useSyncLifecycle', () => {
  it('does nothing while signed out', () => {
    renderHook(() => useSyncLifecycle(deps, null));
    expect(ensureOwner).not.toHaveBeenCalled();
    expect(subscribeChanges).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('claims the local data, starts syncing, and syncs on focus, reconnect and remote changes', async () => {
    const { unmount } = renderHook(() => useSyncLifecycle(deps, 'user-a'));
    await waitFor(() => expect(scheduler.start).toHaveBeenCalledTimes(1));
    expect(ensureOwner).toHaveBeenCalledWith('user-a');
    expect(subscribeChanges).toHaveBeenCalledWith('user-a', expect.any(Function));

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    subscribeChanges.mock.calls[0]![1]();
    expect(scheduler.request).toHaveBeenCalledTimes(3);

    unmount();
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    expect(scheduler.request).toHaveBeenCalledTimes(3);
  });

  it('restarts for a new user and stops on sign-out', async () => {
    const { rerender } = renderHook(({ userId }) => useSyncLifecycle(deps, userId), {
      initialProps: { userId: 'user-a' as string | null },
    });
    await waitFor(() => expect(scheduler.start).toHaveBeenCalledTimes(1));

    rerender({ userId: 'user-b' });
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scheduler.start).toHaveBeenCalledTimes(2));
    expect(ensureOwner).toHaveBeenLastCalledWith('user-b');
    expect(subscribeChanges).toHaveBeenLastCalledWith('user-b', expect.any(Function));

    rerender({ userId: null });
    expect(scheduler.stop).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('does not start when the user signs out before the local data is ready', async () => {
    let ready!: (switched: boolean) => void;
    ensureOwner.mockReturnValueOnce(new Promise((resolve) => (ready = resolve)));
    const { rerender } = renderHook(({ userId }) => useSyncLifecycle(deps, userId), {
      initialProps: { userId: 'user-a' as string | null },
    });
    rerender({ userId: null });
    ready(false);
    await Promise.resolve();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('syncs when the page becomes visible again', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    renderHook(() => useSyncLifecycle(deps, 'user-a'));

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scheduler.request).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});
