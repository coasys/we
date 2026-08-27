import type { LocalStateField, QueryStateField, SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';
import { discardGuard } from './discardGuard.ts';

export interface FormModalOptions {
  /** What decides whether it is showing — `{ $local: 'composerOpen' }` or a store flag. */
  open: SchemaProp;
  /** How it is dismissed. The backdrop, the close button and Cancel all run it. */
  close: SchemaProp;
  title: Content;
  /** `sm` for one or two fields, `md` (the default) for a form, `lg` for a workspace. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * The fields, in order — usually `field()` calls.
   *
   * They land in the modal's default slot, which is the only one that scrolls: a form that outgrows
   * the viewport scrolls its fields while its title and its Save button stay where they were. Six
   * of the forms this replaced scrolled the whole sheet instead, so on a laptop the Save button was
   * below the fold of a dialog that had no visible way to submit.
   */
  children: SchemaNode[];
  /**
   * State the form owns, declared on the modal itself.
   *
   * On the modal rather than on the page that opens it, because the modal is mounted only while
   * open — so the draft resets when it closes, for free. Every form that declared its drafts higher
   * up had to clear them by hand in `onSuccess`, and the ones that forgot re-opened holding what
   * was typed last time.
   */
  localState?: Record<string, LocalStateField>;
  /** Subscriptions the form needs — options for a picker, usually. Same reasoning as `localState`. */
  queries?: Record<string, QueryStateField>;
  submitLabel?: Content;
  /** The action to run. Closing on success is added for you. */
  submit: Record<string, unknown>;
  /**
   * The precondition — what must be filled in before submitting means anything, as an expression
   * over the draft (`{ $not: { $local: 'name' } }`).
   *
   * Combined with the in-flight flag for you, so a caller writes what the *form* requires and never
   * has to remember to `$or` the spinner into it. Leave it out for a form with no precondition.
   *
   * Note this is the "no validation, just a precondition" shape, which is the right one whenever
   * nothing about the value is locally judgeable. A form with real `validate` rules wants the
   * touch-on-submit shape instead, and should stay hand-written — see the house form guidance.
   */
  disabled?: SchemaProp;
  cancelLabel?: Content;
  /** A boolean `$local` to spin the submit button while the action runs. See `confirmModal`. */
  busyLocal?: string;
  /** An in-flight flag somebody else owns — `{ $store: 'spaceStore.creatingSpace' }`. */
  busy?: SchemaProp;
  /**
   * Ask before a backdrop click or Escape throws the draft away — an expression that is true when
   * there is something worth keeping (`{ $or: [{ $local: 'name' }, { $local: 'description' }] }`).
   *
   * Worth it on any form holding more than a word or two. Leave it off for a single-field one,
   * where the guard costs more attention than the field is worth. See `discardGuard`.
   */
  discardWhen?: SchemaProp;
}

/**
 * A titled form in a modal, saving through an action of the caller's choosing.
 *
 * ## Why this exists
 *
 * Ten of these were written out by hand, and they agreed about nothing they should have agreed
 * about. The title was `heading-md` four times, `heading-sm` twice, `subheading` once and a bare
 * `fontWeight: 'semibold'` three times. The button row was `gap: '200'`, `gap: '300'`, and
 * `gap: '300'` with a stray `mt: '200'`. Two of the ten used the header and footer slots — the
 * feature that keeps the Save button on screen — and eight did not. Six set no width at all, which
 * meant the sheet was as wide as its longest placeholder.
 *
 * None of that is a decision anybody made; it is ten people writing the same twenty lines. What
 * differs between the ten is the field list and the action, which is what this takes.
 *
 * ## What it does not cover
 *
 * A form with `validate` rules and a `$touch: '$all'` submit guard. That shape is deliberately
 * different — the button stays clickable and the errors appear on the click that was refused — and
 * folding both into one fragment would mean an option that silently rewires the submit button.
 * `CreateSpaceModal` is the one of those and stays hand-written.
 */
export function formModal(opts: FormModalOptions): SchemaNode {
  const busy = opts.busy ?? (opts.busyLocal ? { $local: opts.busyLocal } : undefined);

  const submitAction = {
    ...opts.submit,
    onSuccess: [opts.close, ...((opts.submit.onSuccess as unknown[]) ?? [])],
  };

  const onClick = opts.busyLocal
    ? [
        { $setLocal: opts.busyLocal, value: true },
        { ...submitAction, onFinally: [{ $setLocal: opts.busyLocal, value: false }] },
      ]
    : submitAction;

  /*
    The precondition and the spinner, combined here rather than at the call site.

    Written by hand this came out as `{ $or: [{ $not: { $local: 'name' } }, { $local: 'creating' }] }`
    in one place and as a bare precondition in five others — which leaves the submit button live
    during its own save, so a second click starts a second one.
  */
  const disabled =
    opts.disabled !== undefined && busy !== undefined ? { $or: [opts.disabled, busy] } : (opts.disabled ?? busy);

  // The guard replaces `close`, adds a flag to the modal's own state, and mounts a confirmation
  // among its children — see `discardGuard` for why all three positions are needed.
  const guard = opts.discardWhen !== undefined ? discardGuard({ dirty: opts.discardWhen, close: opts.close }) : null;
  const localState = { ...opts.localState, ...guard?.localState };

  return {
    // Mounted only while open, rather than hidden — which is what resets the draft between uses.
    type: '$if',
    props: {
      condition: opts.open,
      then: {
        type: 'we-modal',
        props: { size: opts.size ?? 'md', close: guard?.close ?? opts.close },
        ...(Object.keys(localState).length > 0 && { $localState: localState }),
        ...(opts.queries && { $queries: opts.queries }),
        children: [
          {
            type: 'we-text',
            slot: 'header',
            props: { variant: 'heading-md' },
            children: [opts.title],
          },
          ...opts.children,
          ...(guard ? [guard.node] : []),
          {
            type: 'Row',
            slot: 'footer',
            props: { ax: 'end', gap: '300' },
            children: [
              {
                type: 'we-button',
                // Guarded like the backdrop when there is a guard — one way out of the modal, not
                // two that disagree about whether the draft matters.
                props: { variant: 'ghost', onClick: guard?.close ?? opts.close },
                children: [opts.cancelLabel ?? 'Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  variant: 'primary',
                  ...(busy !== undefined && { loading: busy }),
                  ...(disabled !== undefined && { disabled }),
                  onClick,
                },
                children: [opts.submitLabel ?? 'Save'],
              },
            ],
          },
        ],
      },
    },
  };
}
