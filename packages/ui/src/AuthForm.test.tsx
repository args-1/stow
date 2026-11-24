import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthForm } from './AuthForm';

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('AuthForm', () => {
  it('signs in with a trimmed email and shows the returned error', async () => {
    const onSignIn = vi.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    const onSignUp = vi.fn();
    render(<AuthForm onSignIn={onSignIn} onSignUp={onSignUp} />);

    fill('  me@example.com ', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid login credentials');
    expect(onSignIn).toHaveBeenCalledWith('me@example.com', 'secret123');
    expect(onSignUp).not.toHaveBeenCalled();
  });

  it('switches to sign-up and shows the returned info', async () => {
    const onSignUp = vi.fn().mockResolvedValue({ info: 'Check your email to confirm your account.' });
    render(<AuthForm onSignIn={vi.fn()} onSignUp={onSignUp} />);

    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    fill('new@example.com', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect((await screen.findByRole('status')).textContent).toBe('Check your email to confirm your account.');
    expect(onSignUp).toHaveBeenCalledWith('new@example.com', 'secret123');
  });

  it('validates locally before calling the server', () => {
    const onSignIn = vi.fn();
    render(<AuthForm onSignIn={onSignIn} onSignUp={vi.fn()} />);

    fill('me@example.com', '123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('alert').textContent).toBe('Enter your email and a password of at least 6 characters');
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('shows an error when the callback throws', async () => {
    const onSignIn = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    render(<AuthForm onSignIn={onSignIn} onSignUp={vi.fn()} />);

    fill('me@example.com', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Failed to fetch');
  });
});
