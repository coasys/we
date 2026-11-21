import { createSignal } from 'solid-js';

import type { ToastAction, ToastItem, ToastLook, ToastTone } from './Toast.types';

const [toasts, setToasts] = createSignal<ToastItem[]>([]);

let counter = 0;

/** Dismissal timers by toast id, so a manual dismiss can cancel the pending auto-dismiss. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDismiss(id: string, duration: number) {
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => removeToast(id), duration),
    );
  }
}

function addToast(
  message: string,
  tone: ToastTone = 'neutral',
  duration = 4000,
  action?: ToastAction,
  look?: ToastLook,
): string {
  // Collapse a repeat of a toast that is still on screen: refresh its countdown and reuse it
  // rather than stacking an identical copy. One condition can legitimately report many times —
  // a reactive effect re-running, a retry loop — and N identical toasts is noise, not signal.
  //
  // Deliberately scoped to toasts that are *currently visible*: once dismissed, the same message
  // can appear again, so a genuine later recurrence is still shown rather than suppressed forever.
  //
  // The repeat deliberately does NOT restart the countdown. A condition that refires faster than
  // the duration — a reactive effect re-running per node on every dataset change — would otherwise
  // reset the timer indefinitely and pin the toast on screen, unclosable, until whatever is
  // reporting it unmounts. Keeping the original deadline means one transient failure reads as
  // transient however many times it is reported.
  // Not for a toast carrying an action: two "Moved to the space · Undo" toasts are two different
  // things to undo, and collapsing them would leave the first one with no way back. Nor for one
  // naming a sender: the same words from two people are two messages.
  const live =
    !action && !look?.from && toasts().find((t) => t.message === message && t.tone === tone && !t.action && !t.from);
  if (live) return live.id;

  const id = `toast-${++counter}`;
  const toast: ToastItem = {
    id,
    message,
    tone,
    duration,
    ...(action && { action }),
    ...(look?.icon && { icon: look.icon }),
    ...(look?.from && { from: look.from }),
  };

  setToasts((prev) => [...prev, toast]);
  scheduleDismiss(id, duration);

  return id;
}

/**
 * Hold a toast's countdown while somebody is reading it, and resume when they look away.
 *
 * ## Why an auto-dismissing message has to be pausable
 *
 * A toast disappears on a timer, so the timer is the whole failure mode: a message longer than four
 * seconds' reading, or one a person reaches for the dismiss button on, or one a screen-reader user
 * is being read while it vanishes underneath them. WCAG 2.2.1 says a time limit must be
 * extendable; the ordinary way to extend this one is to stop counting while the pointer or focus is
 * on it, which is also what anybody expects when they move the mouse over a message to read it.
 *
 * Paused rather than cancelled: the toast still goes when attention moves on, so nothing
 * accumulates on screen.
 */
function pauseDismiss(id: string) {
  const timer = timers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
}

/** Start the countdown again, from the full duration — the point is to give the reader time. */
function resumeDismiss(id: string) {
  if (timers.has(id)) return;
  const toast = toasts().find((t) => t.id === id);
  if (toast) scheduleDismiss(id, toast.duration ?? 0);
}

function removeToast(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

/*
  An identical error stays muted for this long after it last reached the screen.

  Longer than any toast's duration on purpose: the collapse above covers a repeat
  that arrives while its twin is still showing, but a retry loop that reports the
  same cause every few seconds was free to re-show it the moment it dismissed —
  a strip of identical boxes, each one news only to itself. Thirty seconds is the
  line between "the same report, held" and "a recurrence worth seeing again".
*/
const ERROR_REPEAT_MUTE_MS = 30_000;

/**
 * When each error key last reached the screen, and the toast it showed — the window `error()`
 * enforces. Entries past the window are pruned on every report, so a long session holds only the
 * last thirty seconds of keys, not every distinct message it ever met.
 */
const errorShownAt = new Map<string, { at: number; id: string }>();

/** How many error keys are muted right now. For tests of the pruning. */
export const errorMuteSize = (): number => errorShownAt.size;

/**
 * Show an error, unless the same failure reached the screen inside the mute window.
 *
 * `key` says what "the same failure" is. It defaults to the text, which is right for a background
 * source repeating itself; a caller whose words are shared by independent failures — "Could not
 * open that space" for space A and then space B — passes a key naming the subject, so the second
 * is shown rather than read as a repeat of the first.
 *
 * Always answers with a toast id. A muted repeat answers with the id the key's report got, which
 * may name a toast already dismissed: removing it is then a no-op.
 */
function reportError(message: string, duration?: number, key: string = message): string {
  const now = Date.now();
  for (const [held, shown] of errorShownAt) {
    if (now - shown.at >= ERROR_REPEAT_MUTE_MS) errorShownAt.delete(held);
  }
  const shown = errorShownAt.get(key);
  if (shown) return shown.id;
  const id = addToast(message, 'danger', duration);
  errorShownAt.set(key, { at: now, id });
  return id;
}

export const toastService = {
  get toasts() {
    return toasts;
  },
  add: addToast,
  remove: removeToast,
  /** Stop a toast's countdown while it is being read. See `pauseDismiss`. */
  pause: pauseDismiss,
  /** Start it again once attention moves on. */
  resume: resumeDismiss,
  info: (message: string, duration?: number, action?: ToastAction, look?: ToastLook) =>
    addToast(message, 'neutral', duration, action, look),
  success: (message: string, duration?: number, action?: ToastAction, look?: ToastLook) =>
    addToast(message, 'success', duration, action, look),
  warning: (message: string, duration?: number) => addToast(message, 'warning', duration),
  error: reportError,
};
