import type { SchemaNode } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface ConfirmModalOptions {
  /**
   * The boolean `$local` that opens it. Must be declared by an ancestor — on a card, that means
   * `cardShell`'s `localState`, since the button that sets it lives in the card's header.
   */
  openLocal: string;
  title: string;
  /** What confirming will do, and whether it can be undone. */
  body: Content;
  confirmLabel: string;
  /** The action to run. Closing the modal on success is added for you. */
  confirm: Record<string, unknown>;
  confirmVariant?: string;
  cancelLabel?: string;
  /**
   * A boolean `$local` to spin the confirm button while the action runs, set before it and cleared
   * in `onFinally`.
   *
   * Worth declaring whenever the action is not instant — a recursive delete walks its whole
   * collection, and without a spinner the button absorbs the click and appears to have failed,
   * which invites a second click at a delete already running. Cleared in `onFinally` rather than
   * `onError` because on the success path the node usually unmounts with the record; a failure that
   * left the button spinning forever is the worse end of that trade.
   */
  busyLocal?: string;
}

/**
 * "Are you sure?", with the gate that opens it.
 *
 * Returns the `$if` as well as the modal, so a caller writes one node rather than remembering that
 * a modal must be conditionally mounted — three of these existed and all three were the same twelve
 * lines around a different sentence.
 *
 * The cancel button and the close handler both clear `openLocal`, and so does the action's
 * `onSuccess`: the modal is never left open over a completed action, and never closed over a
 * running one.
 */
export function confirmModal(opts: ConfirmModalOptions): SchemaNode {
  const close = { $setLocal: opts.openLocal, value: false };
  const confirmAction = { ...opts.confirm, onSuccess: [close, ...((opts.confirm.onSuccess as unknown[]) ?? [])] };

  const onClick = opts.busyLocal
    ? [
        { $setLocal: opts.busyLocal, value: true },
        { ...confirmAction, onFinally: [{ $setLocal: opts.busyLocal, value: false }] },
      ]
    : confirmAction;

  return {
    type: '$if',
    props: {
      condition: { $local: opts.openLocal },
      then: {
        type: 'we-modal',
        props: { close },
        children: [
          { type: 'we-text', props: { fontWeight: 'semibold' }, children: [opts.title] },
          { type: 'we-text', children: [opts.body] },
          {
            type: 'Row',
            props: { ax: 'end', gap: '200' },
            children: [
              {
                type: 'we-button',
                props: { variant: 'ghost', onClick: close },
                children: [opts.cancelLabel ?? 'Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  variant: opts.confirmVariant ?? 'danger',
                  ...(opts.busyLocal && {
                    loading: { $local: opts.busyLocal },
                    disabled: { $local: opts.busyLocal },
                  }),
                  onClick,
                },
                children: [opts.confirmLabel],
              },
            ],
          },
        ],
      },
    },
  };
}
