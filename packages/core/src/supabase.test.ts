import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLinkstashClient, FETCH_TIMEOUT_MS, timeoutFetch } from './supabase';

/** Like fetch against a server that never answers: settles only when its signal aborts. */
const hangingFetch = vi.fn<typeof fetch>(
  (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
);

const settled = (promise: Promise<unknown>) => {
  const state = { done: false };
  promise.then(
    () => (state.done = true),
    () => (state.done = true),
  );
  return state;
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  hangingFetch.mockClear();
});

describe('timeoutFetch without AbortSignal.any', () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;

  afterEach(() => {
    Object.defineProperty(AbortSignal, 'any', original);
  });

  function withoutAbortSignalAny() {
    Object.defineProperty(AbortSignal, 'any', { ...original, value: undefined });
    vi.useFakeTimers();
  }

  it('rejects a request that never answers once the timeout passes', async () => {
    withoutAbortSignalAny();
    const result = timeoutFetch(FETCH_TIMEOUT_MS, hangingFetch)('https://example.supabase.co/rest/v1/links');
    const state = settled(result);

    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
    expect(state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it("still aborts when the caller's signal aborts, before or during the request", async () => {
    withoutAbortSignalAny();
    const fetchWithTimeout = timeoutFetch(FETCH_TIMEOUT_MS, hangingFetch);

    const controller = new AbortController();
    const result = fetchWithTimeout('https://example.supabase.co/rest/v1/links', { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });

    await expect(fetchWithTimeout('https://example.supabase.co', { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer once the response arrives', async () => {
    withoutAbortSignalAny();
    const response = new Response('[]');
    const ok = vi.fn<typeof fetch>(async () => response);

    await expect(timeoutFetch(FETCH_TIMEOUT_MS, ok)('https://example.supabase.co')).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('timeoutFetch with AbortSignal.any', () => {
  it('rejects a request that never answers once the timeout passes', async () => {
    await expect(timeoutFetch(20, hangingFetch)('https://example.supabase.co')).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it("still aborts when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const result = timeoutFetch(FETCH_TIMEOUT_MS, hangingFetch)('https://example.supabase.co', {
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createLinkstashClient', () => {
  it('gives up on a database request that never answers', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const client = createLinkstashClient('https://example.supabase.co', 'sb_publishable_test', undefined, {
      autoRefreshToken: false,
      fetchTimeoutMs: 20,
    });

    // retry(false): postgrest-js would otherwise retry a failed GET three times with backoff.
    const { error, status } = await client.from('links').select('id').retry(false);
    expect(hangingFetch).toHaveBeenCalled();
    expect(status).toBe(0);
    expect(error?.message).toMatch(/TimeoutError/);
  });
});
