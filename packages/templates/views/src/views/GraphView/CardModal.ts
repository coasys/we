import type { SchemaNode } from '@we/schema-shared';
import { composerModal } from '@we/template-kit';

/**
 * A card, opened — straight into the composer.
 *
 * The card on the canvas is a preview: clipped, non-interactive, and deliberately so. This is where
 * the whole thing is readable, and it is the trade that made in-place editing unnecessary for now —
 * seeing the content on the board is most of the value, and a modal is where WE already authors
 * everything.
 *
 * ## Why there is no read-only step
 *
 * There was one: a modal that rendered the card and offered an Edit button, which opened a *second*
 * modal to change it. The composer already displays a document properly, so the first was a copy of
 * the second with the ability removed — two dialogs deep to fix a typo, and a reader who never
 * edits sees the same thing either way. Reading and editing are not different enough here to be
 * different surfaces.
 *
 * Editing reconciles through `updatePost`, which keeps the blocks whose ids survived the edit — so a
 * card holds on to its comments, its signals and its placement. Closing without saving changes
 * nothing, which is what makes it safe to be the only door.
 *
 * ## Why it is mounted at the route
 *
 * A `CollectionBlock` is a composed document wherever it was found. The knowledge map and the
 * content tree draw them too, and the modal that reads one has no interest in which map you came
 * from.
 */
export const openCardModal: SchemaNode = {
  type: '$if',
  props: {
    /*
      Bound to the selection rather than to a copied id.

      There is nowhere to copy an id to — `$setLocal`'s `value` is a literal and its `from` reads the
      event — and binding to the selection is the better answer anyway: the modal is always showing
      the node that is selected and cannot drift from it. Guarded on the type as well, since only a
      composed document has an `editorState` to render.
    */
    condition: { $: "local.cardOpen && local.selected.recordId && local.selected.type == 'CollectionBlock'" },
    then: {
      type: '$single',
      props: {
        item: { $query: { entity: 'CollectionBlock', where: { id: { $: 'local.selected.recordId' } } } },
        as: 'card',
      },
      children: [
        composerModal({
          openLocal: 'cardOpen',
          title: 'Card',
          saveLabel: 'Save',
          editorState: { $: 'card.editorState' },
          // `'$arg'` goes second: `updatePost(postId, json)`.
          saveAction: { $action: 'spaceStore.updatePost', args: [{ $: 'card.id' }, { $: 'arg' }] },
          onSaved: [{ $setLocal: 'revision', value: { $: 'local.revision + 1' } }],
        }),
      ],
    },
  },
};
