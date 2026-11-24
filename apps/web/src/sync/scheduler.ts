import type { SyncResult } from '@linkstash/core';

export const SYNC_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;

/** Delay before retry number `failures` (1-based): 1 s, 2 s, 4 s … up to one minute. */
export function backoffDelay(failures: number): number {
  return Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

export interface SyncSchedulerOptions {
  run(): Promise<SyncResult>;
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
  stop(): void;
  /** Asks for a sync now. Ignored while stopped; during a run, queues one more run. */
  request(): void;
}

export function createSyncScheduler(options: SyncSchedulerOptions): SyncScheduler {
  const intervalMs = options.intervalMs ?? SYNC_INTERVAL_MS;
  let active = false;
  let running = false;
  let again = false;
  let failures = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  async function runLoop(): Promise<void> {
    running = true;
    let authAttempt = 0;
    try {
      do {
        again = false;
        const result = await options.run();
        if (!active) return;
        if (result === 'retry') {
          failures++;
          options.onRetry?.(failures);
          retryTimer = setTimeout(request, backoffDelay(failures));
          return;
        }
        if (result === 'auth') {
          if (!(await options.onAuth(authAttempt++))) return;
          again = true;
        } else {
          failures = 0;
        }
      } while (again && active);
    } finally {
      running = false;
    }
  }

  function request(): void {
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(retryTimer);
    retryTimer = undefined;
    runLoop().catch((error: unknown) => {
      if (active) options.onError(error);
    });
  }

  return {
    start() {
      if (active) return;
      active = true;
      failures = 0;
      interval = setInterval(request, intervalMs);
      request();
    },
    stop() {
      active = false;
      again = false;
      clearInterval(interval);
      clearTimeout(retryTimer);
      interval = undefined;
      retryTimer = undefined;
    },
    request,
  };
}
