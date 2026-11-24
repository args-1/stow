import type { Session, SupabaseClient } from '@linkstash/core';
import { Bookmark, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getServices, type Services } from '../../lib/services';
import { SaveScreen } from './SaveScreen';
import { SignIn } from './SignIn';

type SessionState = { status: 'loading' } | { status: 'ready'; session: Session | null };

/** Supabase reports the stored session as its first event, so no separate getSession() call is needed. */
function useSession(supabase: SupabaseClient): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ status: 'ready', session }));
    return () => data.subscription.unsubscribe();
  }, [supabase]);
  return state;
}

function SetupNotice() {
  return (
    <div className="space-y-2 text-sm">
      <h1 className="font-semibold">Connect Linkstash to Supabase</h1>
      <p>
        This build has no Supabase settings. Copy <code>apps/extension/.env.example</code> to{' '}
        <code>apps/extension/.env</code>, set <code>WXT_SUPABASE_URL</code> and <code>WXT_SUPABASE_PUBLISHABLE_KEY</code>,
        then build the extension again.
      </p>
      <p>The README's "Supabase setup" section shows where to find both values.</p>
    </div>
  );
}

interface HeaderProps {
  appUrl: string;
  onSignOut?: () => void;
}

function Header({ appUrl, onSignOut }: HeaderProps) {
  return (
    <header className="mb-4 flex items-center gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
        <Bookmark aria-hidden="true" className="size-4" />
        Linkstash
      </p>
      <a
        href={appUrl}
        target="_blank"
        rel="noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-xs text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
      >
        Open Linkstash
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </a>
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="text-xs text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
        >
          Sign out
        </button>
      )}
    </header>
  );
}

function Popup({ services }: { services: Services }) {
  const session = useSession(services.supabase);
  const signOut = () => void services.supabase.auth.signOut({ scope: 'local' });

  return (
    <>
      <Header appUrl={services.config.appUrl} onSignOut={session.status === 'ready' && session.session ? signOut : undefined} />
      {session.status === 'loading' ? (
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Loading…
        </p>
      ) : session.session ? (
        <SaveScreen services={services} />
      ) : (
        <SignIn supabase={services.supabase} />
      )}
    </>
  );
}

export function App() {
  const services = getServices();
  return <div className="w-[360px] p-4">{services ? <Popup services={services} /> : <SetupNotice />}</div>;
}
