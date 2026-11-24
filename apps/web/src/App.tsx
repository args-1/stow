import { buttonClass } from '@stow/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { Toaster } from './components/Toaster';
import { useOnline, useOwner, useSession } from './hooks';
import { Library } from './Library';
import { useServices } from './services';
import type { SharedLink } from './share';
import { useSyncLifecycle } from './sync/useSyncLifecycle';

export interface AppProps {
  /** A link shared to the installed app before it started. */
  share?: SharedLink | null;
  /** Called by the Reload button on the error screen. Defaults to reloading the page. */
  onReload?: () => void;
}

const reloadPage = () => location.reload();

export function App({ share: sharedAtStart = null, onReload = reloadPage }: AppProps) {
  const services = useServices();
  const session = useSession(services.supabase);
  const owner = useOwner(services.store);
  const online = useOnline();
  const [share, setShare] = useState(sharedAtStart);
  const clearShare = useCallback(() => setShare(null), []);

  const userId = session.status === 'ready' ? (session.session?.user.id ?? null) : null;
  const openError = useSyncLifecycle(services, userId);

  let screen: ReactNode = null;
  if (openError) {
    screen = <ErrorScreen message={openError} onReload={onReload} />;
  } else if (session.status === 'ready' && owner !== undefined) {
    const library = <Library share={share} onShareOpened={clearShare} />;
    if (userId) {
      // Shown once useSyncLifecycle has claimed this device's data for the user.
      if (owner === userId) screen = library;
    } else if (owner && !online) {
      // The stored session could not be refreshed offline. The links on this device are still readable.
      screen = library;
    } else {
      screen = <AuthScreen supabase={services.supabase} online={online} />;
    }
  }

  return (
    <>
      {screen}
      <Toaster />
    </>
  );
}

function ErrorScreen({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div
        role="alert"
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-sm"
      >
        <p className="mb-4 text-sm text-ink">{message}</p>
        <button type="button" className={buttonClass} onClick={onReload}>
          Reload
        </button>
      </div>
    </main>
  );
}