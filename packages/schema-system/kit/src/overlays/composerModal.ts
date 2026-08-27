/**
 * A block composer in a modal, saving through an action of the caller's choosing.
 *
 * Every composed artifact in WE is written this way — a post, an edit to one, a channel message, a
 * reply, a kanban card — because they differ only in which action runs and what it is anchored to.
 * The composer, the file-storage blob, the search index and the mention edges are identical.
 *
 * ## Why this is a fragment rather than something each template writes
 *
 * Because the save path is a **handshake**, and getting it wrong fails in the worst available way.
 *
 * `BlockComposer.onSave` does not fire when the user types, or when the modal closes. It fires when
 * somebody calls the composer's own `save()`, which it hands out exactly once through `onReady`. So
 * the sequence is: `onReady` stores that function in a `function`-typed local, the button calls it
 * with `$callLocal`, `save()` serializes the Lexical tree, and `onSave` runs the action with the
 * tree as `$arg`.
 *
 * Written the obvious way instead — a button that calls the action with a `draft` local the
 * composer was expected to have filled in — it typechecks, validates, renders, and posts `null`,
 * surfacing as `Cannot read properties of null (reading 'type')` from deep inside `persistNode`,
 * several frames from the cause. **And `onReady` is optional**: omit it and the composer renders a
 * floppy-disk save button of its own, so the screen ends up with two buttons, one of which works.
 *
 * The pull shape is right, to be clear — the tree is only wanted at submit, and pushing a
 * serialization on every keystroke to keep a `draft` warm would be waste. What was wrong is that
 * nothing told you. Now one fragment knows, and `semanticValidation` refuses a `BlockComposer` with
 * `onSave` and no `onReady`.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { discardGuard } from './discardGuard.ts';

export interface ComposerModalOptions {
  /**
   * `$localState` boolean controlling visibility, declared on an ancestor of the **button that
   * opens it** — not merely of this modal. Undeclared, `$setLocal` warns and no-ops: the button
   * renders, takes the click, and does nothing.
   */
  openLocal: string;
  /** Modal heading — "New post", "Edit post", "Reply". */
  title: string;
  /**
   * The action to run, with `'$arg'` standing where the serialized tree goes.
   *
   * A placeholder the caller positions rather than an argument appended for them, because the tree
   * is not always last: `updatePost(postId, json)` takes it second and `createPost(json, options)`
   * takes it first. An implicit append would silently serve one and corrupt the other.
   */
  saveAction: { $action: string; args: SchemaProp[] };
  /** Primary button label. Defaults to "Post". */
  saveLabel?: string;
  /**
   * Actions to run once the save has succeeded, after the modal closes itself.
   *
   * `saveAction` deliberately takes only `$action` and `args` — the lifecycle is this fragment's,
   * because closing on success and clearing the in-flight flag are what the handshake is for, and a
   * caller supplying its own `onSuccess` would silently replace both. That left no way to react to a
   * save at all, which is a real gap: a graph has to be told to re-read, a list may want to scroll to
   * what was just written. These run alongside the fragment's own rather than instead of them.
   */
  onSaved?: SchemaProp[];
  /** Content to prefill — `{ $: 'post.editorState' }` for an edit. Omit for a blank composition. */
  editorState?: SchemaProp;
  /**
   * Ask before a backdrop click or Escape throws the draft away. **On by default** — pass `false`
   * only for a composer where losing the content costs nothing.
   *
   * On by default here and opt-in on `formModal`, because a composer is the one place in WE where
   * somebody may have written several paragraphs, and it is the one place a template author cannot
   * write the guard themselves: the content lives inside Lexical, so no `$local` can see whether
   * anything was typed. The composer reports that through `onDirtyChange`, which this wires up.
   */
  guardDraft?: boolean;
}

export function composerModal(opts: ComposerModalOptions): SchemaNode {
  const close = { $setLocal: opts.openLocal, value: false };
  /*
    `draftDirty` is written by the composer, not by the schema. It is the one piece of modal state
    in the kit whose source is a component rather than a control, because Lexical's document is not
    reachable from `$local` — see `BlockComposer.onDirtyChange`.
  */
  const guard = opts.guardDraft === false ? null : discardGuard({ dirty: { $: 'local.draftDirty' }, close });

  return {
    /*
      Mounted only while open, rather than hidden. Remounting is what resets the composer between
      uses — a modal left mounted keeps the last draft, so re-opening "New post" would show what was
      cancelled a minute ago.
    */
    type: '$if',
    props: {
      condition: { $: `local.${opts.openLocal}` },
      then: {
        type: 'we-modal',
        // A workspace, not a form: the composer is a document editor and wants the room. `ax` used
        // to be `center` here, which shrink-wrapped the scroll region to the longest line of text
        // and turned the composer's own overflow into a horizontal scrollbar — see the note on
        // `[part='content']` in `modal.ts`. Nothing needs it: the children below are `width: 100%`.
        props: { size: 'lg', close: guard?.close ?? close },
        $localState: {
          /** The composer's own `save()`, handed over by `onReady`. Read by `$callLocal`. */
          savePost: { type: 'function', initial: null },
          submitting: { type: 'boolean', initial: false },
          ...(guard && {
            /** Whether the author has written anything since the composer loaded. */
            draftDirty: { type: 'boolean', initial: false },
            ...guard.localState,
          }),
        },
        children: [
          { type: 'we-text', props: { variant: 'heading-md' }, children: [opts.title] },
          {
            type: 'Column',
            // `pl` clears the composer's own left gutter, where the slash-command affordance sits.
            props: { width: '100%', bg: 'surface-raised', p: '600', pl: '900', r: '400', overflow: 'auto' },
            children: [
              {
                type: 'BlockComposer',
                props: {
                  ...(opts.editorState !== undefined && { editorState: opts.editorState }),
                  ...(guard && { onDirtyChange: { $setLocal: 'draftDirty', value: { $: 'event' } } }),
                  onReady: { $setLocal: 'savePost', value: { $: 'event.save' } },
                  onSave: [
                    { $setLocal: 'submitting', value: true },
                    {
                      $action: opts.saveAction.$action,
                      args: opts.saveAction.args,
                      // The close first, so anything the caller adds runs against a modal that has
                      // already gone — a refresh it triggers repaints what is behind, not under it.
                      onSuccess: [{ $setLocal: opts.openLocal, value: false }, ...(opts.onSaved ?? [])],
                      onFinally: [{ $setLocal: 'submitting', value: false }],
                    },
                  ],
                },
              },
            ],
          },
          {
            type: 'Row',
            props: { gap: '300', ax: 'end', mt: '200', width: '100%' },
            children: [
              {
                type: 'we-button',
                // Guarded like the backdrop, so the modal has one way out rather than two that
                // disagree — the house precedent is the model wizard, whose Cancel routes through
                // the same `requestCloseWizard` its backdrop does.
                props: { variant: 'ghost', onClick: guard?.close ?? close },
                children: ['Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  variant: 'primary',
                  loading: { $: 'local.submitting' },
                  // Disabled only while in flight, never on "nothing typed yet" — the house rule.
                  // Nothing about a draft is locally judgeable anyway.
                  disabled: { $: 'local.submitting' },
                  onClick: { $callLocal: 'savePost' },
                },
                children: [opts.saveLabel ?? 'Post'],
              },
            ],
          },
          /*
            The question itself. Omitting this while still taking the guard's `close` is a modal
            with no way out: the backdrop raises a flag, and nothing in the tree reads it. That is
            not a hypothetical — it shipped, and it made "New post" inescapable the moment anything
            was typed. `kit.test.ts` now fails any guarded fragment that raises the flag without
            mounting something that reads it.
          */
          ...(guard ? [guard.node] : []),
        ],
      },
    },
  };
}
