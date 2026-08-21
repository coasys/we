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
 * ## What is deliberately absent
 *
 * Editing a card's text on the canvas. Text entry inside a transformed, zoomable surface is its own
 * piece of work, and the graph engine's own notes have said so twice; faking it would teach the
 * wrong thing about what exists. Composing happens in the modal, and a card is dragged afterwards.
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
      // A card carries its text inside the box — the node *is* the content, rather than a mark with
      // a caption — which is what `shape: 'card'` means and why `size` stops applying.
      { style: { shape: 'card', width: 180, color: 'primary-100', labelColor: 'primary-900' } },
      { when: { 'data.kind': 'note' }, style: { color: 'warning-100', labelColor: 'warning-900' } },
      { when: { 'data.kind': 'call' }, style: { color: 'success-100', labelColor: 'success-900' } },
      // Anything that is not a composed card — a task somebody put here, a model instance the
      // community defined — reads as its own kind of thing rather than as a note that lost its text.
      { when: { type: { not: 'CollectionBlock' } }, style: { color: 'neutral-100', labelColor: 'neutral-800' } },
      { when: { type: 'TaskBlock' }, style: { color: 'primary-50', labelColor: 'primary-800' } },
      { when: { type: 'EventBlock' }, style: { color: 'warning-50', labelColor: 'warning-800' } },
    ],
    behaviours: ['pan-zoom', 'select', { type: 'drag-node', options: { pin: true } }],
    // `lock` rather than `pin`: every card is placed already, so there is nothing to hold, and the
    // risk worth guarding against is rearranging somebody else's board by accident.
    controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    height: '100%',
    revision: { $local: 'revision' },
    onNodeClick: selectNode,
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
  saveAction: {
    $action: 'spaceStore.createPost',
    // `'$arg'` first: `createPost(json, options)`.
    args: ['$arg', { kind: 'card', parentId: BOARD, predicate: 'we://children' }],
  },
  // Tell the canvas to re-read. The engine also watches `CollectionBlock` and would get there on its
  // own, but this is the one case where the template *knows* — it is what wrote the card — and
  // waiting on a notification for something you just did is how a board comes to feel broken.
  onSaved: [{ $setLocal: 'revision', by: 1 }],
});

/** The canvas, or a reason there is nothing on it. */
export const boardCanvas: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', position: 'relative' },
  children: [
    newBoardModal,
    newCardModal,
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
