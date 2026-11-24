import { RemoteError, type Session } from '@stow/core';
import { AuthApiError, AuthRetryableFetchError } from '@stow/core/testing';
import { describe, expect, it } from 'vitest';
import { hasSession } from './session';

type GetSession = Parameters<typeof hasSession>[0]['getSession'];

// hasSession only checks that a session exists.
const session = { access_token: 'token', user: { id: 'user-1' } } as Session;
const auth = (result: Awaited<ReturnType<GetSession>>) => ({ getSession: async () => result });

describe('hasSession', () => {
  it('is true while a session is stored', async () => {
    expect(await hasSession(auth({ data: { session }, error: null }))).toBe(true);
  });

  it('is false when signed out', async () => {
    expect(await hasSession(auth({ data: { session: null }, error: null }))).toBe(false);
  });

  it('is false when the stored session can no longer be refreshed', async () => {
    const error = new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found');
    expect(await hasSession(auth({ data: { session: null }, error }))).toBe(false);
  });

  it('throws a retryable error when the server cannot be reached', async () => {
    const error = new AuthRetryableFetchError('Failed to fetch', 0);
    const result = hasSession(auth({ data: { session: null }, error }));
    await expect(result).rejects.toBeInstanceOf(RemoteError);
    await expect(result).rejects.toMatchObject({ status: 0 });
  });
});