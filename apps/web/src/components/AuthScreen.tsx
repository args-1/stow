import type { SupabaseClient } from '@linkstash/core';
import { AuthForm, type AuthResult } from '@linkstash/ui';
import { Bookmark } from 'lucide-react';

const OFFLINE: AuthResult = { error: 'You are offline. Connect to the internet to sign in.' };

export interface AuthScreenProps {
  supabase: SupabaseClient;
  online: boolean;
}

export function AuthScreen({ supabase, online }: AuthScreenProps) {
  async function signIn(email: string, password: string): Promise<AuthResult> {
    if (!online) return OFFLINE;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    if (!online) return OFFLINE;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return data.session ? {} : { info: 'Check your email to confirm your account, then sign in.' };
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
          <Bookmark aria-hidden="true" className="size-4" />
          Linkstash
        </p>
        <AuthForm onSignIn={signIn} onSignUp={signUp} />
      </div>
    </main>
  );
}
