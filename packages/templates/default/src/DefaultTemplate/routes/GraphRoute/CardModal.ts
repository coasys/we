import type { SchemaNode } from '@we/schema-shared';
import { composerModal } from '@we/template-kit';

/**
 * A card, opened.
 *
 * The card on the canvas is a preview — clipped, non-interactive, and deliberately so. This is where
 * the whole thing is readable and editable, which is the trade that made in-place editing
 * unnecessary for now: seeing the content on the board is most of the value, and a modal is where
 * WE already authors everything.
 *
 * Mounted at the route rather than inside the board, because a `CollectionBlock` is a composed
 * document wherever it was found — the knowledge map and the content tree draw them too, and the
 * modal that reads one has no interest in which map you came from.
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
    condition: {
      $and: [
        { $local: 'cardOpen' },
        { $local: 'selected.recordId' },
        { $eq: [{ $local: 'selected.type' }, 'CollectionBlock'] },
      ],
    },
    then: {
      type: 'we-modal',
      props: {
        close: { $setLocal: 'cardOpen', value: false },
        maxWidth: 'var(--we-layout-md)',
        width: '100%',
      },
      $localState: { editCardOpen: { type: 'boolean', initial: false } },
      children: [
        {
          type: '$single',
          props: {
            item: { $query: { entity: 'CollectionBlock', where: { id: { $local: 'selected.recordId' } } } },
            as: 'card',
          },
          children: [
            {
              type: 'Column',
              props: { gap: '400', width: '100%' },
              children: [
                { type: 'BlockRenderer', props: { editorState: '$card.editorState' } },
                {
                  type: 'Row',
                  props: { gap: '300', width: '100%' },
                  children: [
                    {
                      type: 'we-button',
                      props: { size: 'sm', variant: 'secondary', onClick: { $setLocal: 'editCardOpen', value: true } },
                      children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }, 'Edit'],
                    },
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'ghost',
                        color: 'danger-600',
                        ml: 'auto',
                        // Deletes the card and everything composed into it — the one delete that
                        // serves every collection, kind-agnostic by design.
                        onClick: {
                          $action: 'spaceStore.deleteCollection',
                          args: ['$card.id'],
                          onSuccess: [
                            { $setLocal: 'cardOpen', value: false },
                            { $setLocal: 'selected', value: null },
                            { $setLocal: 'revision', by: 1 },
                          ],
                        },
                      },
                      children: [{ type: 'we-icon', props: { name: 'trash' } }, 'Delete'],
                    },
                  ],
                },
                /*
                  Editing reconciles rather than re-creates: `updatePost` keeps the blocks whose ids
                  survived the edit, so a card's comments and signals stay attached to it and its
                  placement is untouched. `'$arg'` goes second here — `updatePost(postId, json)`.
                */
                composerModal({
                  openLocal: 'editCardOpen',
                  title: 'Edit card',
                  saveLabel: 'Save',
                  editorState: '$card.editorState',
                  saveAction: { $action: 'spaceStore.updatePost', args: ['$card.id', '$arg'] },
                  onSaved: [{ $setLocal: 'revision', by: 1 }],
                }),
              ],
            },
          ],
        },
      ],
    },
  },
};
