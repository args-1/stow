import type { ReactNode } from 'react';

const SIZES = { md: 'size-9', sm: 'size-8' } as const;

export interface IconButtonProps {
  label: string;
  onClick(): void;
  children: ReactNode;
  /** Set for toggle buttons; exposed as aria-pressed. */
  pressed?: boolean;
  /** 'sm' is the 32 px button used on link cards. */
  size?: keyof typeof SIZES;
  className?: string;
}

export function IconButton({ label, onClick, children, pressed, size = 'md', className = '' }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={
        `inline-flex ${SIZES[size]} shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-highlight ` +
        'hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong ' +
        className
      }
    >
      {children}
    </button>
  );
}
