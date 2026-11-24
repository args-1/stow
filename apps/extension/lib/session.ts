import { isAuthRetryableFetchError, RemoteError, type SupabaseClient } from '@stow/core';

/**
 * Whether the user is signed in. getSession() refreshes an expired token: if that fails for lack of a
 * network this throws a retryable RemoteError ("offline", not "signed out"). Any other auth error, such as
 * a revoked refresh token, means the session is gone.
 */
export async function hasSession(auth: Pick<SupabaseClient['auth'], 'getSession'>): Promise<boolean> {
  const { data, error } = await auth.getSession();
  if (error) {
    if (isAuthRetryableFetchError(error)) throw new RemoteError(`session: ${error.message}`, 0);
    return false;
  }
  return data.session !== null;
}