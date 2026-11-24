// `:read-only` also matches every <select>, so the read-only look is limited to text controls.
export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint ' +
  'focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent-strong/30 ' +
  '[&:is(input,textarea):read-only]:bg-surface-muted [&:is(input,textarea):read-only]:text-ink-muted ' +
  'disabled:opacity-60';

export const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent ' +
  'hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium ' +
  'text-ink hover:bg-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong ' +
  'disabled:opacity-60';

export const labelClass = 'block text-xs font-medium text-ink-muted';
