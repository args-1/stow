import { activeCategories, countByCategory, type Category, type Link, type LinkView } from '@linkstash/core';
import { ColorDot } from '@linkstash/ui';
import { Archive, Inbox, Settings2, Star, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';

const VIEWS: { value: LinkView; label: string; Icon: LucideIcon }[] = [
  { value: 'all', label: 'All', Icon: Inbox },
  { value: 'favorites', label: 'Favorites', Icon: Star },
  { value: 'archive', label: 'Archive', Icon: Archive },
];

export interface FilterNavProps {
  view: LinkView;
  onViewChange(view: LinkView): void;
  categoryId: string | null;
  onCategoryChange(categoryId: string | null): void;
  categories: readonly Category[];
  links: readonly Link[];
  onManageCategories(): void;
}

const itemClass = (selected: boolean) =>
  'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm md:w-full ' +
  (selected
    ? 'bg-indigo-600 text-white'
    : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800');

export function FilterNav(props: FilterNavProps) {
  const { view, onViewChange, categoryId, onCategoryChange, categories, links, onManageCategories } = props;
  const list = useMemo(() => activeCategories(categories), [categories]);
  const counts = useMemo(() => countByCategory(links), [links]);

  return (
    <nav aria-label="Filters" className="space-y-2 md:space-y-6">
      <div role="group" aria-label="View" className="flex gap-1 md:flex-col">
        {VIEWS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            className={itemClass(view === value)}
            onClick={() => onViewChange(value)}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
        <h2 className="hidden px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase md:block">Categories</h2>
        {list.length > 0 && (
          <div role="group" aria-label="Category filter" className="flex gap-2 md:flex-col md:gap-1">
            {list.map((category) => {
              const selected = categoryId === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={selected}
                  className={itemClass(selected)}
                  onClick={() => onCategoryChange(selected ? null : category.id)}
                >
                  <ColorDot color={category.color} />
                  <span className="max-w-40 truncate md:flex-1 md:text-left">{category.name}</span>
                  <span className="text-xs opacity-70">{counts[category.id] ?? 0}</span>
                </button>
              );
            })}
          </div>
        )}
        <button type="button" className={itemClass(false)} onClick={onManageCategories}>
          <Settings2 aria-hidden="true" className="size-4" />
          Manage categories
        </button>
      </div>
    </nav>
  );
}
