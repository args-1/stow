import type { SyncResult } from '@linkstash/core';

export const SYNC_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;

/** Delay before retry number `failures` (1-based): 1 s, 2 s, 4 s … up to one minute. */
export function backoffDelay(failures: number): number {
  return Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

export interface SyncSchedulerOptions {
  /** One sync. `signal` aborts when the scheduler stops; whatever the run then returns or throws is ignored. */
  run(signal: AbortSignal): Promise<SyncResult>;
  /** Called when `run` returns 'auth'. Resolve true to run again now, false to wait for the next trigger. */
  onAuth(attempt: number): Promise<boolean>;
  /** Called after each consecutive 'retry', with the number of failures so far. */
  onRetry?(failures: number): void;
  /** Called when `run` throws. The scheduler then waits for the next trigger. */
  onError(error: unknown): void;
  intervalMs?: number;
}

export interface SyncScheduler {
  start(): void;
  /** Stops the timers and aborts the current run. */
  stop(): void;
  /**
   * Asks for a sync now. Ignored while stopped. During a run, queues one more run once that run succeeds;
   * if it ends in 'retry', 'auth' or an error, the backoff timer, `onAuth` or the next trigger decides instead.
   */
  request(): void;
}

/** State for one start()…stop() span, so a run left over from a stopped session cannot affect the next one. */
interface Session {
  readonly controller: AbortController;
  running: boolean;
  again: boolean;
  failures: number;
  interval?: ReturnType<typeof setInterval>;
  retryTimer?: ReturnType<typeof setTimeout>;
}

export function createSyncScheduler(options: SyncSchedulerOptions): SyncScheduler {
  const intervalMs = options.intervalMs ?? SYNC_INTERVAL_MS;
  let session: Session | null = null;

  async function runLoop(s: Session): Promise<void> {
    const { signal } = s.controller;
    s.running = true;
    let authAttempt = 0;
    try {
      do {
        s.again = false;
        const result = await options.run(signal);
        if (signal.aborted) return;
        if (result === 'retry') {
          s.failures++;
          options.onRetry?.(s.failures);
          s.retryTimer = setTimeout(request, backoffDelay(s.failures));
          return;
        }
        if (result === 'auth') {
          if (!(await options.onAuth(authAttempt++))) return;
          s.again = true;
        } else {
          s.failures = 0;
        }
      } while (s.again && !signal.aborted);
    } finally {
      s.running = false;
    }
  }

  function request(): void {
    const s = session;
    if (!s) return;
    if (s.running) {
      s.again = true;
      return;
    }
    clearTimeout(s.retryTimer);
    s.retryTimer = undefined;
    runLoop(s).catch((error: unknown) => {
      if (!s.controller.signal.aborted) options.onError(error);
    });
  }

  return {
    start() {
      if (session) return;
      session = { controller: new AbortController(), running: false, again: false, failures: 0 };
      session.interval = setInterval(request, intervalMs);
      request();
    },
    stop() {
      const s = session;
      if (!s) return;
      session = null;
      s.controller.abort();
      clearInterval(s.interval);
      clearTimeout(s.retryTimer);
    },
    request,
  };
}
