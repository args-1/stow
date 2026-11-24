import type { SupabaseClient } from '@linkstash/core';
import { AuthForm, type AuthResult } from '@linkstash/ui';

const OFFLINE: AuthResult = { error: 'You are offline. Connect to the internet to sign in.' };

export function SignIn({ supabase }: { supabase: SupabaseClient }) {
  async function signIn(email: string, password: string): Promise<AuthResult> {
    if (!navigator.onLine) return OFFLINE;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    if (!navigator.onLine) return OFFLINE;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return data.session ? {} : { info: 'Check your email to confirm your account, then sign in.' };
  }

  return <AuthForm onSignIn={signIn} onSignUp={signUp} />;
}
