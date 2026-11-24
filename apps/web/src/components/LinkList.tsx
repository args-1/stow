import { activeCategories, queryLinks, type Category, type Link, type LinkQuery } from '@stow/core';
import { useMemo } from 'react';
import type { Actions } from '../actions';
import { errorText, toast } from '../toast';
import { LinkCard } from './LinkCard';

export type LinkActions = Pick<Actions, 'openLink' | 'toggleFavorite' | 'toggleArchive' | 'deleteLink' | 'restoreLink'>;

export interface LinkListProps {
  links: readonly Link[];
  categories: readonly Category[];
  query: LinkQuery;
  actions: LinkActions;
  onEdit(link: Link): void;
}

function report(work: Promise<unknown>): void {
  work.catch((error: unknown) => toast.error(errorText(error)));
}

export function LinkList({ links, categories, query, actions, onEdit }: LinkListProps) {
  const visible = useMemo(() => queryLinks(links, query), [links, query]);
  const categoryById = useMemo(() => new Map(activeCategories(categories).map((c) => [c.id, c])), [categories]);

  if (visible.length === 0) {
    const hasLinks = links.some((link) => !link.deleted_at);
    return (
      <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        {hasLinks ? 'No links match these filters.' : 'No links yet. Add your first one with "Add link".'}
      </p>
    );
  }

  function remove(link: Link) {
    report(
      actions.deleteLink(link.id).then(() => {
        toast.info('Link deleted', { label: 'Undo', run: () => report(actions.restoreLink(link.id)) });
      }),
    );
  }

  return (
    <ul className="space-y-2" aria-label="Links">
      {visible.map((link) => (
        <LinkCard
          key={link.id}
          link={link}
          category={link.category_id ? categoryById.get(link.category_id) : undefined}
          onOpen={() => report(actions.openLink(link.id))}
          onToggleFavorite={() => report(actions.toggleFavorite(link.id))}
          onToggleArchive={() => report(actions.toggleArchive(link.id))}
          onEdit={() => onEdit(link)}
          onDelete={() => remove(link)}
        />
      ))}
    </ul>
  );
}
