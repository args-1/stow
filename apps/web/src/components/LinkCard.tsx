import { displayTitle, faviconFallback, hostname, type Category, type Link } from '@stow/core';
import { CategoryIcon } from '@stow/ui';
import { Archive, ArchiveRestore, Pencil, Star, Trash2 } from 'lucide-react';
import { IconButton } from './IconButton';

export interface LinkCardProps {
  link: Link;
  /** The link's category, if it is still active. */
  category?: Category;
  onOpen(): void;
  onToggleFavorite(): void;
  onToggleArchive(): void;
  onEdit(): void;
  onDelete(): void;
}

export function LinkCard({ link, category, onOpen, onToggleFavorite, onToggleArchive, onEdit, onDelete }: LinkCardProps) {
  const fallbackIcon = faviconFallback(link.url);

  return (
    <li
      className={
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white p-3 ' +
        'shadow-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] dark:border-slate-800 dark:bg-slate-900'
      }
    >
      <img
        src={link.favicon_url ?? fallbackIcon}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="mt-0.5 size-5 rounded"
        onError={(event) => {
          if (event.currentTarget.src !== fallbackIcon) event.currentTarget.src = fallbackIcon;
        }}
      />
      <div className="min-w-0 space-y-1">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          onAuxClick={(event) => {
            if (event.button === 1) onOpen();
          }}
          className="block truncate font-medium hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
        >
          {displayTitle(link)}
        </a>
        <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {category && (
            <span className="inline-flex shrink-0 items-center gap-1">
              <CategoryIcon icon={category.icon} color={category.color} className="size-3.5" />
              {category.name}
            </span>
          )}
          <span className="truncate">{hostname(link.url)}</span>
        </p>
        {link.description && (
          <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{link.description}</p>
        )}
        {link.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Tags">
            {link.tags.map((tag) => (
              <li key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                #{tag}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="col-start-2 -ml-2 flex items-center sm:col-start-3 sm:row-start-1 sm:ml-0">
        <IconButton label="Favorite" pressed={link.is_favorite} onClick={onToggleFavorite}>
          <Star className={`size-4 ${link.is_favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
        </IconButton>
        <IconButton label={link.is_archived ? 'Unarchive' : 'Archive'} onClick={onToggleArchive}>
          {link.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </IconButton>
        <IconButton label="Edit" onClick={onEdit}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label="Delete" onClick={onDelete} className="hover:text-red-600 dark:hover:text-red-400">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}
