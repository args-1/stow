import {
  dedupeKey,
  displayTitle,
  editPatch,
  errorKind,
  hostname,
  normalizeUrl,
  type Category,
  type Link,
  type SupabaseRemote,
} from '@stow/core';
import { buttonClass, ColorDot, LinkForm, linkFormValues, secondaryButtonClass } from '@stow/ui';
import { Check, Pencil, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { activePage, type PageInfo } from '../../lib/page';
import { deleteLink, describeError, patchLink, saveLink } from '../../lib/save';
import type { Services } from '../../lib/services';
import { PagePreview } from './PagePreview';

interface Loaded {
  page: PageInfo;
  categories: Category[];
  saved: Link | null;
}

/** `null` means the active tab is not a web page (for example a browser settings page). */
async function loadPage(server: SupabaseRemote): Promise<Loaded | null> {
  const tab = await activePage();
  const url = tab && normalizeUrl(tab.url);
  if (!tab || !url) return null;
  const [saved, categories] = await Promise.all([server.findLinkByUrlKey(dedupeKey(url)), server.listCategories()]);
  return { page: { ...tab, url }, categories, saved };
}

type View =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; page: PageInfo; categories: Category[] };

export function SaveScreen({ services }: { services: Services }) {
  const { server, supabase } = services;
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ status: 'loading' });
  const [link, setLink] = useState<Link | null>(null);
  const [removed, setRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function explain(e: unknown): string {
    if (errorKind(e) === 'auth') void supabase.auth.signOut({ scope: 'local' });
    return describeError(e);
  }

  useEffect(() => {
    let cancelled = false;
    loadPage(server).then(
      (loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setView({ status: 'unsupported' });
          return;
        }
        setLink(loaded.saved);
        setView({ status: 'ready', page: loaded.page, categories: loaded.categories });
      },
      (e: unknown) => {
        if (!cancelled) setView({ status: 'failed', message: explain(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [server, attempt]);

  function retry() {
    setView({ status: 'loading' });
    setAttempt((n) => n + 1);
  }

  async function submit(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (e) {
      throw new Error(explain(e));
    }
  }

  async function act(task: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  if (view.status === 'loading') {
    return (
      <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
        Loading…
      </p>
    );
  }
  if (view.status === 'unsupported') {
    return <p className="text-sm">Stow can only save web pages (http and https).</p>;
  }
  if (view.status === 'failed') {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {view.message}
        </p>
        <button type="button" className={buttonClass} onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  const { page, categories } = view;

  if (!link) {
    const pageTitle = page.title || hostname(page.url);
    return (
      <div className="space-y-3">
        {removed && (
          <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
            Removed from Stow.
          </p>
        )}
        <PagePreview url={page.url} title={pageTitle} description={page.description} faviconUrl={page.faviconUrl} />
        <LinkForm
          initial={{ url: page.url }}
          metadata={{ title: page.title, description: page.description, faviconUrl: page.faviconUrl }}
          categories={categories}
          urlReadOnly
          titlePlaceholder={pageTitle}
          submitLabel="Save page"
          onSubmit={(input) =>
            submit(async () => {
              const result = await saveLink(services, input);
              setLink(result.link);
              setRemoved(false);
            })
          }
        />
      </div>
    );
  }

  if (editing) {
    return (
      <LinkForm
        key={link.id}
        initial={linkFormValues(link)}
        categories={categories}
        urlReadOnly
        titlePlaceholder={link.title}
        submitLabel="Save changes"
        onSubmit={(input) =>
          submit(async () => {
            setLink(await patchLink(services, link, editPatch(input)));
            setEditing(false);
          })
        }
        onCancel={() => setEditing(false)}
      />
    );
  }

  const category = categories.find((c) => c.id === link.category_id);
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <Check aria-hidden="true" className="size-4" />
        Saved to Stow
      </p>
      <PagePreview url={link.url} title={displayTitle(link)} description={link.description} faviconUrl={link.favicon_url} />
      {(category || link.tags.length > 0) && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          {category && (
            <span className="inline-flex items-center gap-1">
              <ColorDot color={category.color} />
              {category.name}
            </span>
          )}
          {link.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" className="size-4" />
          Edit
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={busy}
          aria-pressed={link.is_favorite}
          onClick={() => act(async () => setLink(await patchLink(services, link, { is_favorite: !link.is_favorite })))}
        >
          <Star aria-hidden="true" className={link.is_favorite ? 'size-4 fill-amber-400 text-amber-500' : 'size-4'} />
          Favorite
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={busy}
          onClick={() =>
            act(async () => {
              await deleteLink(services, link);
              setLink(null);
              setRemoved(true);
            })
          }
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Delete
        </button>
      </div>
    </div>
  );
}
