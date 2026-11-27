/**
 * What a store tells a person outside the screen they are on: a short message that goes away.
 *
 * A store's actions are mostly called from a press in a template, where a rejection reaches only the
 * console, so a failure a person should know about is said as a toast. The stores take this as an
 * argument rather than importing the design system's toast service, which is drawn by a framework;
 * the host lends its own (`toastService` under Solid), and a test hands in one that records.
 */

/** A button on a toast — "Undo", "Open". */
export interface ToastButton {
  label: string;
  run: () => void;
}

/** How a toast looks beyond its tone: its own icon, and whose words it carries when not the app's. */
export interface ToastFace {
  icon?: string;
  from?: { name: string; image?: string; hash?: string };
}

export interface Toasts {
  info: (message: string, duration?: number, action?: ToastButton, look?: ToastFace) => unknown;
  success: (message: string, duration?: number, action?: ToastButton, look?: ToastFace) => unknown;
  warning: (message: string, duration?: number) => unknown;
  /** With `action`, a failure the person can try again from where they are told of it. */
  error: (message: string, duration?: number, action?: ToastButton) => unknown;
  /** Take a toast down early, by what `info` or `success` answered with. */
  remove?(id: unknown): void;
}
