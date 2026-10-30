/**
 * Opening what is on the workshop's canvas: a note in the composer, a record's fields in the inspector.
 *
 * Making things there — the double-click, the chooser, the note composed at the point — is the kit's
 * (`canvasCards.ts` in the template kit), shared with every space canvas. What follows is the half that
 * is the workshop's own, because it goes through the workshop's inspector.
 *
 * Two kinds of thing a canvas holds, and they are authored differently. A **note** is a composed
 * document — a `CollectionBlock` of kind `card`, the post-it — and nobody types a document into a
 * field list, so it goes through the block composer. Everything else is a **record** of some model
 * the space has, a task or an event or a shape the community defined, and the form for one is
 * derived from the model's own declaration. The chooser between them is the one new piece; both
 * surfaces already existed.
 *
 * ## Double-click, and a chooser
 *
 * The graph's own control strip is plugin-based and closed to templates, and the two pills over
 * the canvas are navigation, so the way in is the gesture every other canvas has: double-click
 * empty canvas to make something there. Position first, then content, forced by the composer
 * being a modal that takes focus — and the better order besides, since you know where a note goes
 * before you know what it says. The chooser is what lets one gesture answer for every kind.
 *
 * ## Opening a note
 *
 * Double-click a note and the composer opens on it, exactly as the graph section's canvas does. A
 * card on the canvas is a preview, clipped and non-interactive; this is where the whole thing is
 * readable, and the composer already displays a document properly, so a read-only step in front of
 * it would be the same dialog with the ability removed. Saving reconciles through `updatePost`, so
 * the note keeps its placement, its comments and its signals.
 *
 * A record that is not a note opens in the inspector instead, which is where its fields already
 * are — see `fieldEditor`.
 */
import type { SchemaNode } from '@we/schema-shared';
import { composerModal } from '@we/template-kit';

/**
 * The selected note, opened in the composer. Bound to the selection the inspector reads — the two
 * address parameters — so it is always the note that is selected and cannot drift from it. Guarded
 * on the type as well, since only a composed document has an `editorState` to render.
 */
export const editNoteModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "local.noteOpen && local.inspecting && local.inspectingType == 'CollectionBlock'" },
    then: {
      type: '$single',
      props: {
        item: { $query: { entity: 'CollectionBlock', where: { id: { $: 'local.inspecting' } } } },
        as: 'note',
      },
      children: [
        composerModal({
          openLocal: 'noteOpen',
          title: 'Note',
          saveLabel: 'Save',
          editorState: { $: 'note.editorState' },
          // `arg` second: `updatePost(postId, json)`.
          saveAction: { $invoke: 'spaceStore.updatePost', args: [{ $: 'note.id' }, { $: 'arg' }] },
        }),
      ],
    },
  },
};
