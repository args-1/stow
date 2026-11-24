import type { ReactNode } from 'react';

export interface IconButtonProps {
  label: string;
  onClick(): void;
  children: ReactNode;
  /** Set for toggle buttons; exposed as aria-pressed. */
  pressed?: boolean;
  className?: string;
}

export function IconButton({ label, onClick, children, pressed, className = '' }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 ' +
        'hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ' +
        `dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${className}`
      }
    >
      {children}
    </button>
  );
}
