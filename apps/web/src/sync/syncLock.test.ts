import { describe, expect, it, vi } from 'vitest';
import { FakeLockManager } from '../test/fakeLocks';
import { withSyncLock } from './syncLock';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('withSyncLock', () => {
  it('runs one call at a time across callers', async () => {
    const locks = new FakeLockManager().asLockManager();
    const first = deferred<string>();
    const order: string[] = [];
    const a = withSyncLock(
      async () => {
        order.push('a:start');
        const value = await first.promise;
        order.push('a:end');
        return value;
      },
      locks,
      new AbortController().signal,
    );
    const b = withSyncLock(
      async () => {
        order.push('b:start');
        return 'b';
      },
      locks,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(order).toEqual(['a:start']));

    first.resolve('a');
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('never calls fn when its queued request is aborted', async () => {
    const locks = new FakeLockManager().asLockManager();
    const holder = deferred();
    const held = withSyncLock(() => holder.promise, locks, new AbortController().signal);
    const controller = new AbortController();
    const fn = vi.fn(async () => 'synced');
    const queued = withSyncLock(fn, locks, controller.signal);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    holder.resolve();
    await held;
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls fn directly without Web Locks, unless the signal is already aborted', async () => {
    expect(await withSyncLock(async () => 'direct', undefined, new AbortController().signal)).toBe('direct');

    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => 'never');
    await expect(withSyncLock(fn, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
  });
});
