/** A toast's colour family — the same word `tone` is on every element, from the status ones. */
export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

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

/**
 * Who a toast is from, when it carries somebody's words rather than the app's: a message a bot
 * wrote, say. Drawn as a line above the message, avatar and name, so the reader sees whose words
 * they are before reading them.
 */
export interface ToastSender {
  name: string;
  /** A picture for the avatar. */
  image?: string;
  /** What the avatar's pattern is drawn from when there is no picture: the sender's id. */
  hash?: string;
}

/** What a toast may carry beside its message and its action. */
export interface ToastLook {
  /** An icon in place of its tone's, for a toast that is one kind of news: a robot for a bot's. */
  icon?: string;
  from?: ToastSender;
}

export interface ToastItem extends ToastLook {
  id: string;
  message: string;
  tone?: ToastTone;
  duration?: number;
  action?: ToastAction;
}

export interface ToastContainerProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  styles?: Record<string, string | number>;
}
