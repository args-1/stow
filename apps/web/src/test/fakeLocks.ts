/** An in-memory exclusive Web Locks manager: one holder per name, FIFO queue, aborting a queued request rejects it. */
export class FakeLockManager {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, (() => void)[]>();

  request<T>(name: string, options: LockOptions, callback: (lock: Lock | null) => T | Promise<T>): Promise<T> {
    const { signal } = options;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      const onAbort = () => {
        queue.splice(queue.indexOf(grant), 1);
        reject(signal?.reason);
      };
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        this.held.add(name);
        Promise.resolve()
          .then(() => callback({ name, mode: 'exclusive' }))
          .then(resolve, reject)
          .finally(() => {
            this.held.delete(name);
            queue.shift()?.();
          });
      };
      if (!this.held.has(name)) {
        grant();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      queue.push(grant);
    });
  }

  asLockManager(): LockManager {
    return this as unknown as LockManager;
  }
}
