import type { SyncResult } from '@stow/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FakeLockManager } from '../test/fakeLocks';
import { backoffDelay, createSyncScheduler, SYNC_INTERVAL_MS, type SyncScheduler } from './scheduler';
import { withSyncLock } from './syncLock';

type Run = (signal: AbortSignal) => Promise<SyncResult>;

let run: Mock<Run>;
let onAuth: Mock<(attempt: number) => Promise<boolean>>;
let onRetry: Mock<(failures: number) => void>;
let onError: Mock<(error: unknown) => void>;
let scheduler: SyncScheduler;

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  run = vi.fn<Run>(async () => 'ok');
  onAuth = vi.fn<(attempt: number) => Promise<boolean>>(async () => false);
  onRetry = vi.fn<(failures: number) => void>();
  onError = vi.fn<(error: unknown) => void>();
  scheduler = createSyncScheduler({ run, onAuth, onRetry, onError });
});

afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('doubles from one second up to a one-minute cap', () => {
    expect([1, 2, 3, 6, 7, 20].map(backoffDelay)).toEqual([1000, 2000, 4000, 32000, 60000, 60000]);
  });
});

describe('createSyncScheduler', () => {
  it('runs on start, on request and on the interval, and does nothing once stopped', async () => {
    scheduler.request();
    await settle();
    expect(run).not.toHaveBeenCalled();

    scheduler.start();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);

    scheduler.stop();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('backs off after failed runs and resets after a successful one', async () => {
    run
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('ok')
      .mockResolvedValueOnce('retry');
    scheduler.start();
    await settle();
    expect(onRetry).toHaveBeenLastCalledWith(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenLastCalledWith(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);

    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenLastCalledWith(1);
  });

  it('runs at once on request instead of waiting out the backoff', async () => {
    run.mockResolvedValueOnce('retry');
    scheduler.start();
    await settle();
    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('queues one more run for any number of requests made during a run', async () => {
    let finish!: (result: SyncResult) => void;
    run.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    scheduler.start();
    await settle();
    scheduler.request();
    scheduler.request();
    expect(run).toHaveBeenCalledTimes(1);

    finish('ok');
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lets onAuth decide whether to run again, counting attempts per run', async () => {
    run.mockResolvedValue('auth');
    onAuth.mockImplementation(async (attempt) => attempt === 0);
    scheduler.start();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(onAuth.mock.calls).toEqual([[0], [1]]);

    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(4);
    expect(onAuth.mock.calls).toEqual([[0], [1], [0], [1]]);
  });

  it('reports a thrown error and waits for the next interval', async () => {
    const boom = new Error('boom');
    run.mockRejectedValueOnce(boom);
    scheduler.start();
    await settle();
    expect(onError).toHaveBeenCalledWith(boom);

    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('aborts the running sync on stop without reporting it or scheduling a retry', async () => {
    run.mockImplementationOnce(
      (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    );
    scheduler.start();
    await settle();
    const signal = run.mock.calls[0][0];
    expect(signal.aborted).toBe(false);

    scheduler.stop();
    await settle();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('never syncs when stopped while waiting for the cross-tab lock', async () => {
    const locks = new FakeLockManager().asLockManager();
    let releaseOtherTab!: () => void;
    const otherTab = withSyncLock(
      () => new Promise<void>((resolve) => (releaseOtherTab = resolve)),
      locks,
      new AbortController().signal,
    );
    const sync = vi.fn<Run>(async () => 'ok');
    scheduler = createSyncScheduler({
      run: (signal) => withSyncLock(() => sync(signal), locks, signal),
      onAuth,
      onRetry,
      onError,
    });

    scheduler.start();
    await settle();
    scheduler.stop();
    releaseOtherTab();
    await otherTab;
    await settle();
    expect(sync).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('runs a restarted session at once even while the stopped run is still unwinding', async () => {
    let finishOld!: (result: SyncResult) => void;
    run.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)));
    scheduler.start();
    await settle();
    scheduler.stop();
    scheduler.start();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0].aborted).toBe(true);
    expect(run.mock.calls[1][0].aborted).toBe(false);

    finishOld('retry');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRetry).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
