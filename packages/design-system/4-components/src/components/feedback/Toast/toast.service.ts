import { createSignal } from 'solid-js';

import type { ToastItem, ToastVariant } from './Toast.types';

const [toasts, setToasts] = createSignal<ToastItem[]>([]);

let counter = 0;

function addToast(message: string, variant: ToastVariant = 'info', duration = 4000): string {
  const id = `toast-${++counter}`;
  const toast: ToastItem = { id, message, variant, duration };

  setToasts((prev) => [...prev, toast]);

  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }

  return id;
}

function removeToast(id: string) {
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
