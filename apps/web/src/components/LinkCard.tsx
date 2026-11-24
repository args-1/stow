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
        'relative flex aspect-square flex-col gap-2 overflow-hidden rounded-xl border border-line bg-surface p-2.5 ' +
        'shadow-sm has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent-strong'
      }
    >
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <img
          src={link.favicon_url ?? fallbackIcon}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-6 shrink-0 rounded"
          onError={(event) => {
            if (event.currentTarget.src !== fallbackIcon) event.currentTarget.src = fallbackIcon;
          }}
        />
        <span className="min-w-0 flex-1 truncate">{hostname(link.url)}</span>
        {category && (
          <span role="img" aria-label={`Category: ${category.name}`} title={category.name} className="relative z-10 shrink-0">
            <CategoryIcon icon={category.icon} color={category.color} />
          </span>
        )}
      </div>
      {/* Stretched link: its ::after covers the card, so tapping anywhere outside the buttons opens it. */}
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onOpen}
        onAuxClick={(event) => {
          if (event.button === 1) onOpen();
        }}
        className={
          'line-clamp-3 text-sm font-medium break-words after:absolute after:inset-0 hover:text-accent-strong ' +
          'focus-visible:outline-none'
        }
      >
        {displayTitle(link)}
      </a>
      <div className="relative z-10 mt-auto flex items-center justify-between">
        <IconButton size="sm" label="Favorite" pressed={link.is_favorite} onClick={onToggleFavorite}>
          <Star className={`size-4 ${link.is_favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
        </IconButton>
        <IconButton size="sm" label={link.is_archived ? 'Unarchive' : 'Archive'} onClick={onToggleArchive}>
          {link.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </IconButton>
        <IconButton size="sm" label="Edit" onClick={onEdit}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton size="sm" label="Delete" onClick={onDelete} className="hover:text-red-600 dark:hover:text-red-400">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}
