import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

/** Tone decides the icon, the colour it is drawn in, and the confirm button's variant, together. */
const TONES = {
  danger: { icon: 'warning', color: 'danger-text', variant: 'danger' },
  primary: { icon: 'question', color: 'accent-text', variant: 'primary' },
} as const;

export interface ConfirmModalOptions {
  /**
   * What decides whether it is showing — `{ $: 'local.confirmDeleteOpen' }`, or a store flag such as
   * `{ $: 'shapeStore.confirmDiscard' }`.
   *
   * A resolvable expression rather than the name of a `$local`, which is what this used to take.
   * Four of the confirmations in the codebase are gated on a *store* — a wizard's "discard this?"
   * belongs to the wizard's own state, not to whichever node happens to render it — and none of
   * them could be written with this fragment, so all four were hand-written instead. That is the
   * whole reason the dialog people see most often was the one nobody had styled.
   */
  open: SchemaProp;
  /**
   * How it is dismissed. Used by the backdrop, the close button and — unless `cancel` overrides it
   * — the cancel button, so there is one answer to "this is over" rather than three that can drift.
   *
   * An action rather than a flag to clear, because clearing is not always what closing means: one
   * of these is gated on a *string* (`confirmDeleteShapeId`, closed by setting `''`) and three run
   * a store action.
   */
  close: SchemaProp;
  title: Content;
  /** What confirming will do, and whether it can be undone. */
  body?: Content;
  /**
   * A second, quieter line — a consequence worth naming but not worth the same weight as the first.
   *
   * Worth having as its own option rather than more `body`, because the alternative is a caller
   * reaching for `color: 'text-muted'` by hand, and the point of the fragment is that it doesn't
   * have to.
   */
  detail?: Content;
  /** Anything else between the text and the buttons — a `we-alert` for a surprising consequence. */
  children?: SchemaNode[];
  confirmLabel: Content;
  /**
   * The action to run. Closing on success is added for you.
   *
   * One action, not a list: all seven of these run exactly one, and a list would raise the question
   * of where the close goes in it.
   */
  confirm: Record<string, unknown> | unknown[];
  cancelLabel?: Content;
  /**
   * What the cancel button does, when merely closing is not it — "Keep editing" dismisses the
   * question *and* leaves the wizard behind it open, which is a different act from closing.
   * Defaults to `close`.
   */
  cancel?: SchemaProp;
  /** `danger` (the default) for anything destructive; `primary` for a question with no casualty. */
  tone?: keyof typeof TONES;
  /** Overrides the tone's icon, for a dialog whose subject has a better one of its own. */
  icon?: string;
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
  /**
   * An in-flight flag somebody else owns — `{ $: 'accountStore.busy' }`.
   *
   * The read-only counterpart of `busyLocal`, and not the same option wearing two names: this one
   * is only bound, where `busyLocal` is set and cleared around the action. A store that runs the
   * work already knows when it is running, and a second flag beside it could only disagree.
   */
  busy?: SchemaProp;
}

/**
 * "Are you sure?", with the gate that opens it.
 *
 * Returns the `$if` as well as the modal, so a caller writes one node rather than remembering that
 * a modal must be conditionally mounted — three of these existed and all three were the same twelve
 * lines around a different sentence.
 *
 * ## Why it grew
 *
 * Because the version that took an `openLocal` string and a single action could express three of
 * the codebase's seven confirmations, and the other four were written by hand: the model wizard's
 * "Discard this model?" and "Replace the fields below?" are gated on store flags, its "Remove this
 * model?" on a string, and account removal on a pending record. Two of those needed a cancel button
 * that does something other than close. So the dialog a person is most likely to meet — the one
 * guarding work they have half-finished — was the one with no shared design, and it showed: no
 * icon, a semibold line where every other heading is a heading, and a width left to however long
 * the sentence happened to be.
 *
 * `open`/`close` as expressions, plus `cancel` and `tone`, are exactly what those four needed. The
 * hand-written ones are gone.
 *
 * The cancel button and the close handler both run `close`, and so does the action's `onSuccess`:
 * the dialog is never left open over a completed action, and never closed over a running one.
 */
export function confirmModal(opts: ConfirmModalOptions): SchemaNode {
  const tone = TONES[opts.tone ?? 'danger'];
  const busy = opts.busy ?? (opts.busyLocal ? { $: `local.${opts.busyLocal}` } : undefined);

  /*
    Where the close goes depends on what the confirm actually is.

    `$action` is the only token with lifecycle hooks, and the close belongs in its `onSuccess` so it
    waits for the promise — closing before it resolves loses the spinner and the error path. Every
    other token is synchronous, and giving *those* an `onSuccess` writes a key the resolver never
    reads: it was spliced onto them unconditionally, so a `$setLocal` confirm silently never closed
    the dialog. Nothing had noticed because the only such caller is `discardGuard`, whose confirm
    unmounts the whole modal anyway.
  */
  // A handler array is a confirm too — `discardGuard` hands over whatever the modal's `close` is,
  // and a composer's close can be several steps (close, then clear a presence activity). Nested
  // arrays are not flattened by the resolver, so the steps are spliced in rather than wrapped.
  const isAction = !Array.isArray(opts.confirm) && '$action' in opts.confirm;
  const confirmAction = isAction
    ? {
        ...(opts.confirm as Record<string, unknown>),
        onSuccess: [opts.close, ...(((opts.confirm as Record<string, unknown>).onSuccess as unknown[]) ?? [])],
      }
    : opts.confirm;
  const confirmSteps = Array.isArray(confirmAction) ? confirmAction : [confirmAction];

  const onClick = opts.busyLocal
    ? // `busyLocal` only means anything around an async action — see its doc comment.
      [
        { $setLocal: opts.busyLocal, value: true },
        { ...(confirmAction as Record<string, unknown>), onFinally: [{ $setLocal: opts.busyLocal, value: false }] },
      ]
    : isAction
      ? confirmAction
      : [...confirmSteps, opts.close];

  return {
    type: '$if',
    props: {
      condition: opts.open,
      then: {
        type: 'we-modal',
        // The smallest sheet: a confirmation is read in one glance, and the widths these used to
        // pick for themselves ranged from "too narrow to hold the sentence" to the full 900.
        props: { size: 'sm', close: opts.close },
        children: [
          {
            type: 'Row',
            slot: 'header',
            props: { gap: '300', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: opts.icon ?? tone.icon, color: tone.color } },
              { type: 'we-text', props: { variant: 'heading-sm' }, children: [opts.title] },
            ],
          },
          {
            /*
              The scrolling half — the default slot is the only one the modal scrolls.

              Its own Column rather than loose children, because the modal's gap separates the three
              slotted groups and is far too much between a sentence and the quieter sentence under it.
            */
            type: 'Column',
            props: { gap: '300' },
            children: [
              ...(opts.body !== undefined ? [{ type: 'we-text', children: [opts.body] }] : []),
              ...(opts.detail !== undefined
                ? [{ type: 'we-text', props: { color: 'text-muted' }, children: [opts.detail] }]
                : []),
              ...(opts.children ?? []),
            ],
          },
          {
            type: 'Row',
            // Pinned below the scroll region, so a dialog carrying an alert or a long consequence
            // scrolls what it says and never the two buttons that answer it.
            slot: 'footer',
            props: { ax: 'end', gap: '300' },
            children: [
              {
                type: 'we-button',
                /*
                  `secondary`, not `ghost`. Ghost has no resting appearance — that is its whole
                  point, and it is right for an inline affordance or an icon button. In a dialog
                  footer it makes the dismissing option read as a label sitting beside the real
                  button rather than as the other choice. Secondary gives it a resting box, so the
                  pair reads as two options with the primary still carrying the emphasis.

                  Set here rather than at each call site because these fragments ARE the global
                  control: four of them own nearly every cancel button in the app.
                */
                props: { variant: 'secondary', onClick: opts.cancel ?? opts.close },
                children: [opts.cancelLabel ?? 'Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  variant: tone.variant,
                  ...(busy !== undefined && { loading: busy, disabled: busy }),
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
