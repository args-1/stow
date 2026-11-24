import { useSyncExternalStore } from 'react';

export interface ToastAction {
  label: string;
  run(): void;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  message: string;
  action?: ToastAction;
}

export const TOAST_MS = 5000;
export const ACTION_TOAST_MS = 8000;

let toasts: readonly Toast[] = [];
let lastId = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

function show(kind: Toast['kind'], message: string, action?: ToastAction): number {
  if (!action) {
    const same = toasts.find((t) => !t.action && t.kind === kind && t.message === message);
    if (same) return same.id;
  }
  const id = ++lastId;
  toasts = [...toasts, action ? { id, kind, message, action } : { id, kind, message }];
  timers.set(id, setTimeout(() => dismiss(id), action ? ACTION_TOAST_MS : TOAST_MS));
  emit();
  return id;
}

export function dismiss(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  info: (message: string, action?: ToastAction) => show('info', message, action),
  error: (message: string, action?: ToastAction) => show('error', message, action),
};

export const getToasts = (): readonly Toast[] => toasts;

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, getToasts);
}
