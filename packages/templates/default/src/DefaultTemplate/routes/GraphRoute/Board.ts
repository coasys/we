import type { SchemaNode } from '@we/schema-shared';
import { composerModal, emptyState } from '@we/template-kit';

import { selectNode } from './NodeDetail';

/**
 * The board — the same engine, with position as the data.
 *
 * Every other mode on this route *derives* an arrangement: force settles a knowledge map, tree
 * ranks containment, the schema map is laid out from relations nobody chose. A board is the one
 * where somebody put a thing somewhere because that is what they meant, and the layout's whole job
 * is to leave it alone. `manual` reads each card's own `x`/`y`; `drag-node` with `pin: true` is what
 * makes a dropped card stay dropped rather than being reclaimed on the next change; and
 * `onNodeDragEnd` writes the drop back, which is the only reason any of it survives a reload.
 *
 * ## What a card is
 *
 * A `CollectionBlock`, parented to the board through `we://children` — which is to say, a post that
 * happens to live on a board. That is not a shortcut: it means a card holds composed content
 * (`BlockComposer` writes it, `BlockRenderer` reads it), carries comments and signals like anything
 * else, and is found by everything that already walks a collection. Nothing here is board-shaped
 * except the two numbers.
 *
 * ## Reading and editing
 *
 * A card draws its real content — `content: 'block'` mounts the same renderer a post card uses — so
 * a note holding a photo and three paragraphs looks like one rather than like sixty characters of
 * its first line. Clipped, not scrolled: a card is a preview, and what does not fit is reached by
 * opening it.
 *
 * Editing is that modal rather than the canvas. Text entry inside a transformed, zoomable surface is
 * its own piece of work — the engine's notes have said so three times — and once the content is
 * *visible* in place, the remaining value of typing in place is small next to what it costs. Worth
 * revisiting after this has been used, not before.
 */

/** Which board is open. A picker writes it; the seed refuses to load until it is set. */
const BOARD = { $local: 'boardId' };

const boardCards: SchemaNode = {
  type: 'GraphView',
  props: {
    // The `board` seed reads the board's contents *and* the placements recorded against it, and
    // merges the coordinates into each node. A template names the board and nothing else.
    seeds: { source: 'board', options: { board: BOARD } },
    // Nothing opens automatically: a board shows what is on it, and drilling into a card's own
    // blocks would turn a wall of notes into a tree of fragments.
    expansion: { defaultDepth: 0 },
    layout: { type: 'manual' },
    nodeStyle: [
      /*
        A card carries its content inside the box — the node *is* the thing, rather than a mark with
        a caption, which is what `shape: 'card'` means and why `size` stops applying.

        `content: 'block'` draws the post itself: its text, its images, its tasks. A label could only
        ever be the first line, so a card holding a photo and three paragraphs showed sixty
        characters and gave no sign the rest existed.

        Clipped, not scrolled, and that is the design: a card is a *preview*, and what does not fit
        is reached by opening it. Below half zoom it falls back to the label, because a hundred
        documents rendered at once is a hundred component trees and none of them is legible at the
        size where a board reads as coloured rectangles.
      */
      {
        style: {
          shape: 'card',
          width: 180,
          color: 'primary-100',
          labelColor: 'primary-900',
          content: 'block',
          contentMinZoom: 0.5,
        },
      },
      { when: { 'data.kind': 'note' }, style: { color: 'warning-100', labelColor: 'warning-900' } },
      { when: { 'data.kind': 'call' }, style: { color: 'success-100', labelColor: 'success-900' } },
      // Anything that is not a composed card — a task somebody put here, a model instance the
      // community defined — reads as its own kind of thing rather than as a note that lost its text.
      { when: { type: { not: 'CollectionBlock' } }, style: { color: 'neutral-100', labelColor: 'neutral-800' } },
      { when: { type: 'TaskBlock' }, style: { color: 'primary-50', labelColor: 'primary-800' } },
      { when: { type: 'EventBlock' }, style: { color: 'warning-50', labelColor: 'warning-800' } },
    ],
    behaviours: [
      // The two halves of a double-click: on a node it opens, on empty canvas it creates. Both
      // before pan-zoom, which is the background fallback and would otherwise claim the press first.
      'node-double-click',
      'canvas-double-click',
      'pan-zoom',
      'select',
      { type: 'drag-node', options: { pin: true } },
    ],
    // `lock` rather than `pin`: every card is placed already, so there is nothing to hold, and the
    // risk worth guarding against is rearranging somebody else's board by accident.
    controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    height: '100%',
    revision: { $local: 'revision' },
    onNodeClick: selectNode,
    // Double-click opens the card. Nothing expands on a board, so the gesture is free — and it is
    // the one people arrive expecting from every other canvas they have used.
    onNodeDoubleClick: { $setLocal: 'openCardId', from: '$event.recordId' },
    /*
      Double-click empty canvas to make something there.

      Position first, then content — forced by the composer being a modal that takes focus and covers
      the canvas, so "click to place" cannot be the last step. It is also the better order: you know
      where a note goes before you know what it says.
    */
    onCanvasDoubleClick: [
      { $setLocal: 'newCardAt', from: '$event' },
      { $setLocal: 'newCardOpen', value: true },
    ],
    /*
      The drop, written back.

      Without this the board is a layout that forgets — and worse, forgets silently, since the cards
      stay where they were dropped until the next reload.

      An upsert against the *board*, not an update of the record. A coordinate is a fact about the
      pair, so the same note can sit on two boards in two places, and the record itself never learns
      it was on a board at all. `recordId`/`recordType` rather than the node's address: the graph
      names a node `we-graph://entity/<dataset>/<type>/<id>` and a template has no operator that
      could take that apart.
    */
    onNodeDragEnd: {
      $action: 'recordStore.placeOnBoard',
      args: [BOARD, '$event.recordId', '$event.recordType', '$event.x', '$event.y'],
    },
  },
};

/** Boards in this space, for the picker. Hoisted so the empty state can count them. */
export const boardQuery = { entity: 'CollectionBlock', where: { kind: 'board' }, order: { createdAt: 'asc' } };

/**
 * The board's own chrome: which board, and adding to it.
 *
 * Separate from the route's mode/layout row because these are about *this* board rather than about
 * how the route draws things — and because the layout picker is meaningless here, position being
 * the data rather than something a layout decides.
 */
export const boardBar: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    {
      type: 'we-select',
      props: {
        size: 'sm',
        placeholder: 'Pick a board…',
        options: {
          $map: { items: { $local: 'boards' }, select: { label: '$item.title', value: '$item.id' } },
        },
        value: BOARD,
        onChange: { $setLocal: 'boardId', from: '$event.detail' },
      },
    },
    {
      type: 'we-button',
      props: {
        size: 'sm',
        variant: 'ghost',
        onClick: { $setLocal: 'newBoardOpen', value: true },
      },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Board'],
    },
    {
      type: '$if',
      props: {
        condition: BOARD,
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            {
              type: 'we-button',
              props: { size: 'sm', variant: 'secondary', onClick: { $setLocal: 'newCardOpen', value: true } },
              children: [{ type: 'we-icon', props: { name: 'note' } }, 'Card'],
            },
            /*
              A model instance, made *onto* this board.

              The same form the New button opens anywhere else — `createOnBoard` only adds the
              intent, so what is created is placed here rather than left loose in the space. That is
              the whole difference between a board that holds a community's own models and one that
              holds sticky notes, and it is one store call rather than a second authoring path.
            */
            {
              type: '$if',
              props: {
                condition: { $count: { items: { $store: 'recordStore.creatableEntities' } } },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    onClick: { $action: 'recordStore.createOnBoard', args: [BOARD] },
                  },
                  children: [{ type: 'we-icon', props: { name: 'cube' } }, 'Record'],
                },
              },
            },
          ],
        },
      },
    },
  ],
};

/** Naming a board. `model.create` rather than the composer — a board is a container, not a document. */
const newBoardModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'newBoardOpen' },
    then: {
      type: 'we-modal',
      props: { close: { $setLocal: 'newBoardOpen', value: false }, maxWidth: 'var(--we-layout-xs)', width: '100%' },
      $localState: { boardName: { type: 'string', initial: '' } },
      children: [
        { type: 'we-text', props: { variant: 'heading-md' }, children: ['New board'] },
        {
          type: 'we-form-field',
          props: { label: 'Name', width: '100%' },
          children: [
            {
              type: 'we-input',
              props: {
                width: '100%',
                placeholder: 'Ideas, retro, roadmap…',
                value: { $local: 'boardName' },
                onInput: { $setLocal: 'boardName', from: '$event.detail' },
              },
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '300', ax: 'end', width: '100%' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $setLocal: 'newBoardOpen', value: false } },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'primary',
                // Nothing about a name is locally judgeable beyond its presence, so this gates on
                // the value itself rather than dragging in the validation machinery.
                disabled: { $not: { $local: 'boardName' } },
                onClick: {
                  $action: 'model.create',
                  args: ['CollectionBlock', { kind: 'board', title: { $local: 'boardName' } }],
                  // Straight into the new board: making one and then having to find it in a picker
                  // is a step nobody wanted.
                  onSuccess: [
                    { $setLocal: 'boardId', from: '$result.id' },
                    { $setLocal: 'newBoardOpen', value: false },
                    { $setLocal: 'revision', by: 1 },
                  ],
                },
              },
              children: ['Create'],
            },
          ],
        },
      ],
    },
  },
};

/**
 * A card, composed.
 *
 * The same handshake every composed artifact in WE uses, anchored to the board through
 * `we://children`. It lands unplaced, which the `manual` layout parks in a grid beside what is
 * already there — and then somebody drags it where they meant it to go, which writes its position.
 * Asking for a position up front would be asking where a thing goes before it exists.
 */
const newCardModal: SchemaNode = composerModal({
  openLocal: 'newCardOpen',
  title: 'New card',
  saveLabel: 'Add',
  /*
    One action, because it is one act.

    The card and the coordinate that says where it sits land as a single commit. Written separately
    they are two, and anything watching the data layer catches the state between them — which is
    exactly what the board did: it drew the card unpositioned, in the tray, for as long as the
    placement took to arrive, and then moved it.

    `newCardAt` is null when the card came from the toolbar rather than a double-click, and the store
    then writes no placement at all: the card lands in the tray, which is the honest answer to
    "nobody said where" and the place it is recoverable from.
  */
  saveAction: {
    $action: 'recordStore.createCardOnBoard',
    // `'$arg'` first: the serialized tree, then where it goes.
    args: ['$arg', { board: BOARD, at: { $local: 'newCardAt' } }],
  },
  onSaved: [
    { $setLocal: 'newCardAt', value: null },
    { $setLocal: 'revision', by: 1 },
  ],
});

/**
 * A card, opened.
 *
 * The card on the canvas is a preview — clipped, non-interactive, and deliberately so. This is where
 * the whole thing is readable and editable, which is the trade that made in-place editing
 * unnecessary for now: seeing the content on the board is most of the value, and a modal is where
 * WE already authors everything.
 */
const openCardModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'openCardId' },
    then: {
      type: 'we-modal',
      props: {
        close: { $setLocal: 'openCardId', value: '' },
        maxWidth: 'var(--we-layout-md)',
        width: '100%',
      },
      $localState: { editCardOpen: { type: 'boolean', initial: false } },
      children: [
        {
          type: '$single',
          props: {
            item: { $query: { entity: 'CollectionBlock', where: { id: { $local: 'openCardId' } } } },
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
                            { $setLocal: 'openCardId', value: '' },
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

/** The canvas, or a reason there is nothing on it. */
export const boardCanvas: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', position: 'relative' },
  children: [
    newBoardModal,
    newCardModal,
    openCardModal,
    {
      type: '$if',
      props: {
        condition: BOARD,
        then: boardCards,
        // Two different absences, said differently: a space with no boards has one thing to do
        // about it, and a space with boards nobody has opened has another.
        else: {
          type: '$if',
          props: {
            condition: { $count: { items: { $local: 'boards' } } },
            then: emptyState({ icon: 'squares-four', label: 'boards', message: 'Pick a board to open it.' }),
            else: emptyState({
              icon: 'squares-four',
              label: 'boards',
              message: 'No boards yet. Make one, and put things on it wherever you like.',
            }),
          },
        },
      },
    },
  ],
};
