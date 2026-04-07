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
    <div role="alert" class={`we-toast we-toast--${variant()}`}>
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
