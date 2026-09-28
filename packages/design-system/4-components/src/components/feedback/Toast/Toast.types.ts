export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

/**
 * One thing a person can do about a toast, beside dismissing it — "Undo" on the thing it reports.
 *
 * One, not a list: a toast is read in a glance, and a second button is a decision it has no room to
 * explain. Pressing it dismisses the toast, because the thing it offered to act on has been acted on.
 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
}

export interface ToastContainerProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  styles?: Record<string, string | number>;
}
