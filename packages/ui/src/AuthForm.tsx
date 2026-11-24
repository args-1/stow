import { useId, useState, type FormEvent } from 'react';
import { Field } from './Field';
import { buttonClass, inputClass } from './styles';

export interface AuthResult {
  error?: string;
  info?: string;
}

export interface AuthFormProps {
  title?: string;
  onSignIn(email: string, password: string): Promise<AuthResult>;
  onSignUp(email: string, password: string): Promise<AuthResult>;
}

/** Supabase Auth's default minimum. */
export const MIN_PASSWORD_LENGTH = 6;

export function AuthForm({ title = 'Sign in to Linkstash', onSignIn, onSignUp }: AuthFormProps) {
  const id = useId();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AuthResult>({});
  const signingUp = mode === 'signUp';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.length < MIN_PASSWORD_LENGTH) {
      setResult({ error: `Enter your email and a password of at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    setPending(true);
    setResult({});
    try {
      setResult(await (signingUp ? onSignUp : onSignIn)(trimmed, password));
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-3">
      <h1 className="text-lg font-semibold">{title}</h1>
      <Field id={`${id}-email`} label="Email">
        <input
          id={`${id}-email`}
          className={inputClass}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field id={`${id}-password`} label="Password">
        <input
          id={`${id}-password`}
          className={inputClass}
          type="password"
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {result.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {result.error}
        </p>
      )}
      {result.info && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {result.info}
        </p>
      )}
      <button type="submit" className={`${buttonClass} w-full`} disabled={pending}>
        {signingUp ? 'Create account' : 'Sign in'}
      </button>
      <button
        type="button"
        className="w-full text-center text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        onClick={() => {
          setMode(signingUp ? 'signIn' : 'signUp');
          setResult({});
        }}
      >
        {signingUp ? 'Already have an account? Sign in' : 'Need an account? Create one'}
      </button>
    </form>
  );
}
