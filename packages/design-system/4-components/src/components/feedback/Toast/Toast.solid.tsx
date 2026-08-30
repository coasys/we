import { For } from 'solid-js';

export type * from './Toast.types';
export { toastService } from './toast.service';
import { toastService } from './toast.service';
import type { ToastContainerProps } from './Toast.types';
import type { ToastItem } from './Toast.types';

const VARIANT_ICONS: Record<string, string> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'x-circle',
};

const VARIANT_COLORS: Record<string, string> = {
  info: 'neutral-500',
  success: 'success-500',
  warning: 'warning-500',
  error: 'danger-500',
};

function ToastItem(props: { toast: ToastItem }) {
  const variant = () => props.toast.variant || 'info';

  return (
    /*
      `role="status"`, not `role="alert"`.

      An alert is assertive: it interrupts whatever a screen reader is saying, mid-word. These are
      already inside an `aria-live="polite"` container, so the two disagreed about urgency and the
      inner role won — every "Copied to clipboard" cut off whatever the reader was in the middle of.
      A status matches the container and matches what a toast is.

      Pausing on hover and on focus is WCAG 2.2.1: a message on a four-second timer must be
      extendable, and the ordinary way to extend one is to stop counting while somebody is reading
      it. `onFocusIn`/`onFocusOut` rather than focus/blur, so reaching the dismiss button counts.
    */
    <div
      role="status"
      class={`we-toast we-toast--${variant()}`}
      onMouseEnter={() => toastService.pause(props.toast.id)}
      onMouseLeave={() => toastService.resume(props.toast.id)}
      onFocusIn={() => toastService.pause(props.toast.id)}
      onFocusOut={() => toastService.resume(props.toast.id)}
    >
      <we-icon name={VARIANT_ICONS[variant()]} color={VARIANT_COLORS[variant()]} size="20px" />
      <span class="we-toast__message">{props.toast.message}</span>
      <button onClick={() => toastService.remove(props.toast.id)} aria-label="Dismiss" class="we-toast__dismiss">
        <we-icon name="x" size="16px" />
      </button>
    </div>
  );
}

export function ToastContainer(props: ToastContainerProps) {
  const position = () => props.position || 'top-right';

  return (
    <div
      aria-live="polite"
      aria-relevant="additions removals"
      class={`we-toast-container we-toast-container--${position()}`}
      style={props.styles}
    >
      <For each={toastService.toasts()}>
        {(toast) => (
          <div class="we-toast-wrapper">
            <ToastItem toast={toast} />
          </div>
        )}
      </For>
    </div>
  );
}
