import { type JSX, Show } from 'solid-js';

export type * from './Dialog.types';
import type { DialogProps } from './Dialog.types';

interface SolidDialogProps extends DialogProps {
  children?: JSX.Element;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function Dialog(props: SolidDialogProps) {
  const variant = () => props.variant || 'default';
  const confirmLabel = () => props.confirmLabel || 'Confirm';
  const cancelLabel = () => props.cancelLabel || 'Cancel';

  return (
    <Show when={props.open}>
      <div class="we-dialog-backdrop" onClick={props.onCancel}>
        <div
          class="we-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          style={props.styles}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={props.title}>
            <h2 id="dialog-title" class="we-dialog__title">
              {props.title}
            </h2>
          </Show>
          <Show when={props.description}>
            <p class="we-dialog__description">{props.description}</p>
          </Show>
          {props.children}
          <div class="we-dialog__actions">
            <we-button variant="ghost" onClick={props.onCancel}>
              {cancelLabel()}
            </we-button>
            <we-button variant={variant() === 'danger' ? 'danger' : 'primary'} onClick={props.onConfirm}>
              {confirmLabel()}
            </we-button>
          </div>
        </div>
      </div>
    </Show>
  );
}
