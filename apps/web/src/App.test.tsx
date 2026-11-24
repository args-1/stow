import { makeLink } from '@linkstash/core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createFakeServices, fakeSession, renderWithServices } from './test/fakeServices';
import { dismiss, getToasts } from './toast';

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
  vi.restoreAllMocks();
});

const goOffline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('App', () => {
  it('signs in and opens the library', async () => {
    const { services, auth, scheduler } = createFakeServices();
    renderWithServices(<App />, services);

    await screen.findByRole('heading', { name: 'Sign in to Linkstash' });
    fillCredentials('me@example.com', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'secret1' });
    expect(scheduler.start).toHaveBeenCalled();
  });

  it('restores the session and starts syncing', async () => {
    const { services, store, scheduler } = createFakeServices(fakeSession('user-1'));
    await store.ensureOwner('user-1');
    await store.apply({ links: [makeLink({ title: 'Kept' })] });
    renderWithServices(<App />, services);

    expect(await screen.findByRole('link', { name: 'Kept' })).toBeTruthy();
    await waitFor(() => expect(scheduler.start).toHaveBeenCalled());
  });

  it('shows saved links offline when the session could not be restored', async () => {
    goOffline();
    const { services, store, scheduler } = createFakeServices();
    await store.ensureOwner('user-1');
    await store.apply({ links: [makeLink({ title: 'Kept' })] });
    renderWithServices(<App />, services);

    expect(await screen.findByRole('link', { name: 'Kept' })).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('explains that signing in needs a connection', async () => {
    goOffline();
    const { services, auth } = createFakeServices();
    renderWithServices(<App />, services);

    await screen.findByRole('heading', { name: 'Sign in to Linkstash' });
    fillCredentials('me@example.com', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe('You are offline. Connect to the internet to sign in.');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('asks new users to confirm their email', async () => {
    const { services, auth } = createFakeServices();
    renderWithServices(<App />, services);

    await screen.findByRole('heading', { name: 'Sign in to Linkstash' });
    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    fillCredentials('new@example.com', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Check your email to confirm your account, then sign in.')).toBeTruthy();
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'secret1' });
  });

  it("removes another account's links before showing the library", async () => {
    const { services, store } = createFakeServices(fakeSession('user-1'));
    await store.ensureOwner('user-2');
    await store.apply({ links: [makeLink({ title: 'Not yours' })] });
    renderWithServices(<App />, services);

    await screen.findByText(/No links yet/);
    expect(screen.queryByText('Not yours')).toBeNull();
    expect(await store.listLinks()).toEqual([]);
  });
});
