import type { LocalStateField, SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';
import { confirmModal } from './confirmModal.ts';

/** The `$localState` boolean the guard raises. Fragment-owned; callers never name it. */
const FLAG = 'confirmDiscardOpen';

export interface DiscardGuardOptions {
  /**
   * True when there is work worth keeping.
   *
   * **Only when there is.** A guard that fires unconditionally asks about an empty form, and a
   * dialog people learn to click through is worse than no dialog — it costs them the one time it
   * was about something. Express it over the draft: `{ $or: [{ $local: 'name' }, …] }` for a blank
   * form, `{ $ne: [{ $local: 'titleDraft' }, '$call.title'] }` for one seeded from a record.
   */
  dirty: SchemaProp;
  /** What actually closes the modal, once discarding is agreed. The unguarded `close`. */
  close: SchemaProp;
  title?: Content;
  body?: Content;
  /** The destructive label. "Discard" by default — name the thing where it helps ("Discard post"). */
  discardLabel?: Content;
  /** The safe label, and the one the dialog should make easy to pick. */
  keepLabel?: Content;
}

/**
 * "Discard what you have typed?" — the guard between a half-filled modal and a stray click.
 *
 * ## Why a modal needs one at all
 *
 * `we-modal` closes on a backdrop click and on Escape, and both are easy to do by accident: the
 * backdrop is every pixel that is not the sheet, and Escape is next to the keys people reach for
 * while writing. Neither is recoverable — the modal is `$if`-mounted, so closing unmounts it and
 * the draft goes with it. Somebody who has typed three paragraphs into a post and brushed the
 * trackpad has no way back.
 *
 * ## What it returns, and why three pieces
 *
 * A modal cannot be guarded from the outside: the flag has to be declared *on* the modal (so it
 * resets with it), the confirmation has to be *inside* it (so it can read that flag), and `close`
 * has to be replaced (so the backdrop asks instead of closing). Those are three different positions
 * in one node, so this returns three things rather than a node:
 *
 * ```ts
 * const guard = discardGuard({ dirty, close });
 * // …
 * { type: 'we-modal',
 *   props: { size: 'md', close: guard.close },
 *   $localState: { ...myFields, ...guard.localState },
 *   children: [ …the form…, guard.node ] }
 * ```
 *
 * `formModal` and `composerModal` take a `discardWhen` option and do all of this themselves; reach
 * for this directly only in a modal that is neither.
 *
 * ## Why `close` is a `$if` rather than always raising the question
 *
 * Because the modal has to keep closing normally when there is nothing to lose. The conditional
 * resolves at click time through the same path a handler array does, so `dirty` is read when the
 * backdrop is clicked rather than when the modal was rendered.
 */
export function discardGuard(opts: DiscardGuardOptions): {
  /** Put on the modal's `close`, in place of the unguarded one. */
  close: SchemaProp;
  /** Merge into the modal's `$localState` — the flag has to reset when the modal unmounts. */
  localState: Record<string, LocalStateField>;
  /** Put among the modal's children. Renders nothing until the question is asked. */
  node: SchemaNode;
} {
  const dismiss = { $setLocal: FLAG, value: false };

  return {
    close: {
      $if: {
        condition: opts.dirty,
        then: { $setLocal: FLAG, value: true },
        else: opts.close,
      },
    } as SchemaProp,

    localState: { [FLAG]: { type: 'boolean', initial: false } },

    node: confirmModal({
      open: { $local: FLAG },
      /*
        Dismissing the question means keeping the work, not discarding it — the safe direction, and
        the one a stray click should land on. So the backdrop and Escape both cancel, and the only
        way to lose the draft is to say so.
      */
      close: dismiss,
      title: opts.title ?? 'Discard your changes?',
      body: opts.body ?? 'What you have typed will be lost. Nothing has been saved yet.',
      cancelLabel: opts.keepLabel ?? 'Keep editing',
      confirmLabel: opts.discardLabel ?? 'Discard',
      /*
        Confirming *is* the close that was intercepted, run at last. Nothing has to put the flag
        back afterwards: the modal it closes is the one holding this `$localState`, so the flag is
        destroyed along with the draft it was guarding.
      */
      confirm: opts.close as Record<string, unknown>,
    }),
  };
}
