export const SYNC_LOCK_NAME = 'linkstash-sync';

/**
 * Runs `fn` while holding the cross-tab sync lock, so one tab syncs at a time. Without Web Locks it calls
 * `fn` directly. If `signal` aborts before the lock is granted, `fn` never runs and the call rejects with
 * the signal's reason.
 */
export function withSyncLock<T>(
  fn: () => Promise<T>,
  locks: LockManager | undefined,
  signal: AbortSignal,
): Promise<T> {
  if (!locks) return signal.aborted ? Promise.reject(signal.reason) : fn();
  return locks.request(SYNC_LOCK_NAME, { signal }, () => fn());
}
