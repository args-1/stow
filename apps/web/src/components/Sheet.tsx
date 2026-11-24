import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';

export interface SheetProps {
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** A modal panel: a bottom sheet on phones, a centered dialog from the `sm` breakpoint up. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onMouseDown={() => onCloseRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          'relative flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl focus:outline-none ' +
          'sm:max-w-lg sm:rounded-2xl'
        }
      >
        <div className="flex items-center justify-between border-b border-line py-2 pr-2 pl-4">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <IconButton label="Close" onClick={() => onCloseRef.current()}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
