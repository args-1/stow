import type { Link, LinkQuery, LinkSort, LinkView } from '@stow/core';
import { Bookmark, LogOut, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CategoryManager } from './components/CategoryManager';
import { FilterNav } from './components/FilterNav';
import { IconButton } from './components/IconButton';
import { LinkList } from './components/LinkList';
import { LinkSheet, type LinkSheetTarget } from './components/LinkSheet';
import { Sheet } from './components/Sheet';
import { StatusBadge } from './components/StatusBadge';
import { Toolbar } from './components/Toolbar';
import { useCategories, useLinks, useOnline, usePendingCount } from './hooks';
import { useServices } from './services';
import type { SharedLink } from './share';
import { errorText, toast } from './toast';

type OpenSheet = { kind: 'link'; target: LinkSheetTarget } | { kind: 'categories' } | null;

export interface LibraryProps {
  /** A link shared to the installed app. It opens in the add sheet. */
  share?: SharedLink | null;
  /** Called once the shared link is open, so the parent can drop it. */
  onShareOpened?(): void;
}

function Brand({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-center gap-2 font-semibold ${className}`}>
      <Bookmark aria-hidden="true" className="size-5 text-indigo-600 dark:text-indigo-400" />
      Stow
    </p>
  );
}

const addButtonClass =
  'fixed right-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 inline-flex size-14 items-center ' +
  'justify-center gap-2 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ' +
  'md:static md:h-auto md:w-auto md:rounded-lg md:px-4 md:py-2 md:text-sm md:font-medium md:shadow-none';

export function Library({ share = null, onShareOpened }: LibraryProps) {
  const { supabase, store, actions, scheduler } = useServices();
  const links = useLinks(store);
  const categories = useCategories(store);
  const pending = usePendingCount(store);
  const online = useOnline();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LinkSort>('newest');
  const [view, setView] = useState<LinkView>('all');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<OpenSheet>(null);

  useEffect(() => {
    if (!share) return;
    setSheet({ kind: 'link', target: { mode: 'add', url: share.url, title: share.title } });
    onShareOpened?.();
  }, [share, onShareOpened]);

  const activeCategoryId =
    categoryId && categories?.some((c) => c.id === categoryId && !c.deleted_at) ? categoryId : null;
  const query = useMemo<LinkQuery>(
    () => ({ search, sort, view, categoryId: activeCategoryId }),
    [search, sort, view, activeCategoryId],
  );

  const closeSheet = () => setSheet(null);
  const openAdd = () => setSheet({ kind: 'link', target: { mode: 'add' } });
  const openEdit = (link: Link) => setSheet({ kind: 'link', target: { mode: 'edit', link } });

  async function signOut() {
    // Counted now: the live pending count reads 0 until its first query resolves.
    const unsynced = await store.db.outbox.count();
    if (unsynced > 0 && !window.confirm('Some changes have not synced yet and will be lost. Sign out anyway?')) return;
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      toast.error(`Could not sign out: ${error.message}`);
      return;
    }
    // Abort any sync still in flight so it cannot push or pull around the wipe.
    scheduler.stop();
    await store.clear();
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-[auto_1fr]">
      <header
        className={
          'sticky top-0 z-30 border-b border-slate-200 bg-slate-50 pt-[env(safe-area-inset-top)] ' +
          'md:col-start-2 md:row-start-1 dark:border-slate-800 dark:bg-slate-950'
        }
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
          <Brand className="md:hidden" />
          <div className="order-last w-full md:order-none md:w-auto md:flex-1">
            <Toolbar search={search} onSearchChange={setSearch} sort={sort} onSortChange={setSort} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <StatusBadge online={online} pending={pending} />
            <button type="button" className={addButtonClass} onClick={openAdd}>
              <Plus aria-hidden="true" className="size-6 md:size-4" />
              <span className="sr-only md:not-sr-only">Add link</span>
            </button>
            <IconButton label="Sign out" onClick={() => void signOut().catch((e: unknown) => toast.error(errorText(e)))}>
              <LogOut className="size-4" />
            </IconButton>
          </div>
        </div>
      </header>
      <aside
        className={
          'border-b border-slate-200 px-4 py-3 md:sticky md:top-0 md:col-start-1 md:row-span-2 md:row-start-1 ' +
          'md:h-dvh md:overflow-y-auto md:border-r md:border-b-0 md:py-4 dark:border-slate-800'
        }
      >
        <Brand className="mb-6 hidden px-3 md:flex" />
        <FilterNav
          view={view}
          onViewChange={setView}
          categoryId={activeCategoryId}
          onCategoryChange={setCategoryId}
          categories={categories ?? []}
          links={links ?? []}
          onManageCategories={() => setSheet({ kind: 'categories' })}
        />
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 pt-4 pb-28 md:col-start-2 md:row-start-2 md:pb-8">
        {links && categories && (
          <LinkList links={links} categories={categories} query={query} actions={actions} onEdit={openEdit} />
        )}
      </main>
      {sheet?.kind === 'link' && (
        <LinkSheet target={sheet.target} categories={categories ?? []} actions={actions} onClose={closeSheet} />
      )}
      {sheet?.kind === 'categories' && (
        <Sheet title="Manage categories" onClose={closeSheet}>
          <CategoryManager categories={categories ?? []} links={links ?? []} actions={actions} />
        </Sheet>
      )}
    </div>
  );
}
