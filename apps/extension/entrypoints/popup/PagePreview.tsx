import { faviconFallback, hostname } from '@stow/core';

export interface PagePreviewProps {
  url: string;
  title: string;
  description?: string | null;
  faviconUrl?: string | null;
}

export function PagePreview({ url, title, description, faviconUrl }: PagePreviewProps) {
  const fallbackIcon = faviconFallback(url);

  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-3">
      <img
        src={faviconUrl || fallbackIcon}
        alt=""
        width={20}
        height={20}
        referrerPolicy="no-referrer"
        className="mt-0.5 size-5 shrink-0 rounded"
        onError={(event) => {
          if (event.currentTarget.src !== fallbackIcon) event.currentTarget.src = fallbackIcon;
        }}
      />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-ink-muted">{hostname(url)}</p>
        {description && <p className="line-clamp-2 text-xs text-ink-muted">{description}</p>}
      </div>
    </div>
  );
}
