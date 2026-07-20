import { createSignal } from 'solid-js';

import type { ToastItem, ToastVariant } from './Toast.types';

const [toasts, setToasts] = createSignal<ToastItem[]>([]);

let counter = 0;

/** Dismissal timers by toast id, so a repeat of a live toast can restart its countdown. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDismiss(id: string, duration: number) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.delete(id);
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => removeToast(id), duration),
    );
  }
}

function addToast(message: string, variant: ToastVariant = 'info', duration = 4000): string {
  // Collapse a repeat of a toast that is still on screen: refresh its countdown and reuse it
  // rather than stacking an identical copy. One condition can legitimately report many times —
  // a reactive effect re-running, a retry loop — and N identical toasts is noise, not signal.
  //
  // Deliberately scoped to toasts that are *currently visible*: once dismissed, the same message
  // can appear again, so a genuine later recurrence is still shown rather than suppressed forever.
  const live = toasts().find((t) => t.message === message && t.variant === variant);
  if (live) {
    scheduleDismiss(live.id, duration);
    return live.id;
  }

  const id = `toast-${++counter}`;
  const toast: ToastItem = { id, message, variant, duration };

  setToasts((prev) => [...prev, toast]);
  scheduleDismiss(id, duration);

  return id;
}

function removeToast(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

export const toastService = {
  get toasts() {
    return toasts;
  },
  add: addToast,
  remove: removeToast,
  info: (message: string, duration?: number) => addToast(message, 'info', duration),
  success: (message: string, duration?: number) => addToast(message, 'success', duration),
  warning: (message: string, duration?: number) => addToast(message, 'warning', duration),
  error: (message: string, duration?: number) => addToast(message, 'error', duration),
};
