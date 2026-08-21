import type { SchemaNode } from '@we/schema-shared';

import { swatchRow } from './Palette';

/**
 * The selected node, opened out — a panel over the right edge of the canvas.
 *
 * A graph draws structure and hides everything else, which is what makes it readable and also why a
 * node on its own says almost nothing: a dot labelled "Ship the docs" is a record with six fields
 * and the map shows one of them. Somewhere has to answer "what is this", and that is host territory
 * rather than engine — the engine already hands over the node.
 *
 * ## Why a panel and not the strip it replaces
 *
 * This was a row along the bottom, and the shape was wrong for what it holds. A strip is **wide and
 * shallow** and a record's fields are a **list**: every field got one line of height and a share of
 * fourteen hundred pixels of width, so six of them read as a smear. A column can afford two lines
 * per field — the name above the value — which is what makes them scannable at all.
 *
 * ## Why it overlays rather than pushing the canvas
 *
 * Pushing means resizing the graph surface, which changes the world rectangle on screen: selecting a
 * card near the right edge would shift what you are looking at, and the node being described can
 * slide underneath the thing describing it. Overlaying leaves the camera exactly where it was.
 *
 * ## Two questions, two surfaces
 *
 * This one answers *what is this* — type, fields, what it connects to. Reading the *document* is the
 * modal's job, because a post in a three-hundred-pixel column is worse than a post in a modal, and
 * metadata in a modal is worse than metadata in a panel: it demands dismissal for something you
 * wanted at a glance. So the panel describes, and offers `Open`.
 */

/** Clearing this is what makes an expansion a request rather than a state — see `expandRequest`. */
const CLEAR = { $setLocal: 'expandKind', value: '' };

/**
 * Selecting a node clears the last request, and re-opens a panel that was dismissed.
 *
 * Without the first, `expandRequest` would still name the previous expanders while its `id` changed
 * to the newly clicked node — so the graph would expand whatever you clicked next, in whichever way
 * you last asked. Without the second, dismissing the panel once would mean selecting anything
 * afterwards silently did nothing visible. Handler arrays run in order, so both land with the
 * selection.
 */
export const selectNode = [
  { $setLocal: 'selected', from: '$event' },
  CLEAR,
  { $setLocal: 'panelClosed', value: false },
];

/**
 * The graph's selection changed — including to nothing.
 *
 * `select` already clears on a background click and reports it; nothing was listening, so the panel
 * stayed open describing a node that was no longer highlighted, and the only way out was to select
 * something else.
 *
 * Bound on every mode rather than only where a background click is likely: a selection that can be
 * emptied by shift-clicking the last node has the same problem, and a handler that only knew about
 * one of the two ways to reach empty would be wrong half the time.
 */
export const clearOnEmptySelection = [
  {
    $if: {
      condition: { $count: { items: '$event' } },
      else: [CLEAR, { $setLocal: 'selected', value: null }, { $setLocal: 'cardOpen', value: false }],
    },
  },
];

/**
 * What the graph is being asked to open, derived rather than stored.
 *
 * `$setLocal`'s `value` is a literal — a token inside it is stored as the token — so a button
 * cannot write `{ id: <the selected node> }` directly. It writes which *kind* of expansion was
 * asked for, and the request is composed here from that plus whatever is selected.
 */
export const expandRequest = {
  $if: {
    condition: { $local: 'expandKind' },
    /*
      `direction: 'both'` because asking is not the same as arriving.

      The maps auto-expand outward, so a node's outgoing relations are already drawn — and a request
      that repeated that fetched the same neighbours, merged them, and changed nothing on screen. A
      button that silently does nothing is worse than no button. What has *not* been fetched is what
      points *at* the node, which is the half of the question a person clicking "Relations" is asking.
    */
    then: { id: { $local: 'selected.id' }, direction: 'both', expanders: [{ $local: 'expandKind' }] },
    else: null,
  },
};

const openButton = (label: string, icon: string, kind: string): SchemaNode => ({
  type: 'we-button',
  props: {
    size: 'xs',
    variant: { $if: { condition: { $eq: [{ $local: 'expandKind' }, kind] }, then: 'secondary', else: 'ghost' } },
    onClick: { $setLocal: 'expandKind', value: kind },
  },
  children: [{ type: 'we-icon', props: { name: icon } }, label],
});

/**
 * How this card looks on this board — colour, shape, and how large its content is drawn.
 *
 * Presentation per placement, which is the reason it can be offered at all: none of it touches the
 * record. Shrinking a post to fit six of them on a wall is not editing the post, the same post on
 * another board keeps its own look, and every setting here is undone by taking the card off the
 * board. That is also why it is a section of the panel rather than a modal — nothing in it needs
 * confirming.
 *
 * Sizing is not here. A card's size is set by dragging its corner, where the feedback is the card
 * itself; two numbers in a panel would be the same act with the answer hidden.
 */
const setStyle = (field: string, value: unknown) => ({
  $action: 'recordStore.setCardStyle',
  args: [{ $local: 'boardId' }, { $local: 'selected.recordId' }, field, value],
  // The graph re-reads and merges, so the change lands on the card rather than at the next reload.
  onSuccess: [{ $setLocal: 'revision', by: 1 }],
});

const cardStyle: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: [{ $eq: [{ $local: 'mode' }, 'board'] }, { $local: 'selected.recordId' }] },
    then: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      children: [
        { type: 'we-divider' },
        { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['Card'] },
        swatchRow({
          current: { $local: 'selected.data.boardColor' },
          pick: (token) => setStyle('color', token),
        }),
        {
          type: 'we-form-field',
          props: { label: 'Shape', size: 'sm', width: '100%' },
          children: [
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '100%',
                value: { $local: 'selected.data.boardCardShape' },
                options: [
                  { label: 'Note', value: 'note' },
                  { label: 'Square', value: 'square' },
                  { label: 'Round', value: 'round' },
                ],
                onChange: setStyle('cardShape', '$event.detail'),
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Content size', size: 'sm', width: '100%' },
          children: [
            {
              /*
                A multiplier on the content, not on the card and not on the stored text.

                The card keeps the size it was given and the document keeps its own formatting; what
                changes is how much of it fits in the box. That is the setting people actually want
                on a wall of notes — read more of a card without making it bigger — and it is why
                this belongs to the placement rather than to the post.
              */
              type: 'we-slider',
              props: {
                size: 'sm',
                width: '100%',
                min: 0.25,
                max: 2,
                step: 0.05,
                showValue: true,
                value: { $local: 'selected.data.boardContentScale' },
                /*
                  Preview while dragging, write on release.

                  A slider reports continuously and a write per frame would be absurd — but waiting
                  for the release to see the result means choosing a size blind, which for "how much
                  of this document fits" is the whole question. Both go through the same pending
                  map, so the card never jumps between the last preview and the write.
                */
                onInput: {
                  $action: 'recordStore.previewCardStyle',
                  args: [{ $local: 'selected.recordId' }, 'contentScale', '$event.detail'],
                },
                onChange: setStyle('contentScale', '$event.detail'),
              },
            },
          ],
        },
      ],
    },
  },
};

/** One field: the name above the value, which is the whole reason this is a column. */
const fieldRow: SchemaNode = {
  type: 'Column',
  props: { gap: '100', width: '100%' },
  children: [
    { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['$field.name'] },
    {
      type: 'we-text',
      // A value with no spaces in it — a URI, an id, a hash — has nowhere to break, so without this
      // one field can push the whole panel sideways. Belt and braces beside the adapter's own cap.
      props: { variant: 'body', styles: { 'overflow-wrap': 'anywhere' } },
      children: ['$field.value'],
    },
  ],
};

/**
 * Actions on the record behind the node.
 *
 * Offered only where there *is* one: a property node, a literal and a synthetic cluster have no
 * record to open, nothing further to expand and nowhere to be removed from, and a button that
 * quietly does nothing teaches people the panel is broken.
 */
const actions: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'selected.recordId' },
    then: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      children: [
        /*
          Opening a node further — and not on a board, where it would do nothing.

          A board draws what is *placed* on it, so a node's relations and fields are not part of the
          map and there is nowhere for them to appear. The board's graph carries no `expandRequest`
          for the same reason, which is what made these two buttons inert there: they set a request
          nothing was listening for.
        */
        {
          type: '$if',
          props: {
            condition: { $ne: [{ $local: 'mode' }, 'board'] },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center', wrap: true, width: '100%' },
              children: [openButton('Relations', 'graph', 'entity'), openButton('Fields', 'list-bullets', 'property')],
            },
          },
        },
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true, width: '100%' },
          children: [
            /*
              Opening the document, wherever the node is one.

              Gated on the type rather than on the mode: a `CollectionBlock` is a composed document
              on a board and on a knowledge map alike, and the modal that reads one does not care
              which map you found it on. A `TaskBlock` has no `editorState`, so it is not offered.
            */
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $local: 'selected.type' }, 'CollectionBlock'] },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'secondary',
                    /*
                      A flag, not an id, because there is nowhere to copy an id *to*.

                      `$setLocal`'s `value` is a literal and its `from` reads a path off the *event*,
                      so a button cannot move `selected.recordId` into another field. The modal reads
                      the selection directly instead — which is also the more honest binding: it is
                      always showing the thing that is selected, and cannot drift from it.
                    */
                    onClick: { $setLocal: 'cardOpen', value: true },
                  },
                  children: [{ type: 'we-icon', props: { name: 'arrow-square-out' } }, 'Open'],
                },
              },
            },
            /*
              Deleting the record itself — offered here because the modal that used to hold it is
              gone. Opening a card now goes straight to the composer, which is the right surface for
              its content and the wrong one for destroying it: a delete button beside a save button
              is a delete button somebody will hit.
            */
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $local: 'selected.type' }, 'CollectionBlock'] },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    color: 'danger-600',
                    // Recursive, and kind-agnostic: the one delete that serves every collection.
                    onClick: {
                      $action: 'spaceStore.deleteCollection',
                      args: [{ $local: 'selected.recordId' }],
                      onSuccess: [
                        { $setLocal: 'selected', value: null },
                        { $setLocal: 'revision', by: 1 },
                      ],
                    },
                  },
                  children: [{ type: 'we-icon', props: { name: 'trash' } }, 'Delete'],
                },
              },
            },
            /*
              Taking something off a board is deleting its placement, and nothing else.

              The counterpart to dragging it on, and the reason placement being membership is worth
              having: the record survives untouched, because being on a board was never what made it
              exist. Board mode only — there is nothing to remove a node from on a map whose
              membership is a query.
            */
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $local: 'mode' }, 'board'] },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    color: 'danger-600',
                    ml: 'auto',
                    onClick: {
                      $action: 'recordStore.removeFromBoard',
                      args: [{ $local: 'boardId' }, { $local: 'selected.recordId' }],
                      onSuccess: [
                        { $setLocal: 'selected', value: null },
                        { $setLocal: 'revision', by: 1 },
                      ],
                    },
                  },
                  children: [{ type: 'we-icon', props: { name: 'x-circle' } }, 'Remove from board'],
                },
              },
            },
          ],
        },
      ],
    },
  },
};

/**
 * The panel's dock: always mounted, on the left edge, and inert until something is in it.
 *
 * The panel cannot position itself. A `$if` with a transition wraps its content in an animation
 * container positioned *from* that content, so an edge offset inside one pins to the wrapper's box
 * rather than the canvas's — and the wrapper sits at its own static position. Docking it in a
 * container that is always there and always where it says it is takes the question away from the
 * wrapper entirely.
 *
 * **Left, because the right belongs to the app.** The module rail runs down that edge and overlaps
 * anything a route puts there. A route cannot see the chrome around it, so the rule is simply that
 * the far edge is not a route's to use — and the key moves to the right in exchange, which is the
 * lighter of the two to lose a strip of.
 *
 * `top` and `bottom` rather than a height: an absolute box pinned to both edges is the same height
 * as the canvas whatever resolves — a percentage height depends on an unbroken chain of resolved
 * heights above it, and where that chain breaks the panel is merely short, with its border stopping
 * in mid-air.
 *
 * `pointerEvents: 'none'` because a column down the side of the canvas would otherwise eat clicks on
 * the board while nothing is selected; the panel inside turns them back on.
 */
export const nodeDetailPanel: SchemaNode = {
  type: 'Column',
  props: {
    position: 'absolute',
    top: '0',
    bottom: '0',
    left: '0',
    zIndex: 'chrome',
    pointerEvents: 'none',
  },
  children: [
    {
      type: '$if',
      props: {
        condition: { $and: [{ $local: 'selected' }, { $not: { $local: 'panelClosed' } }] },
        // Sliding in from the edge it is docked to, so it reads as arriving rather than appearing.
        enterTransition: [
          { type: 'slide', direction: 'right', distance: '24px', duration: 180 },
          { type: 'fade', duration: 150 },
        ],
        then: {
          type: 'Column',
          props: {
            height: '100%',
            width: '320px',
            maxWidth: '100%',
            pointerEvents: 'auto',
            /*
              A shade off the canvas rather than a shade above it.

              `GraphView` paints its own background at `neutral-0`, so the panel cannot be lighter than
              what it sits on — there is nothing lighter. `neutral-25` reads as a distinct surface
              instead: quiet enough not to compete with the map, separate enough that the border is not
              the only thing telling you where the canvas stops.
            */
            bg: 'neutral-25',
            borderRight: '1px solid neutral-200',
            shadow: 'lg',
          },
          children: [
            {
              type: 'Row',
              props: {
                gap: '200',
                ay: 'center',
                width: '100%',
                px: '400',
                py: '300',
                borderBottom: '1px solid neutral-100',
              },
              children: [
                { type: 'we-badge', props: { size: 'xs' }, children: [{ $local: 'selected.type' }] },
                {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    ml: 'auto',
                    /*
                      Closes the panel and leaves the node selected.

                      Deselecting as well would be the easier thing to write and the wrong thing to do:
                      you dismiss a description because you have read it, not because you are done with
                      the thing it described — and the selection is what the expand buttons and the
                      graph's own highlight are keyed on. Selecting anything re-opens it.
                    */
                    onClick: { $setLocal: 'panelClosed', value: true },
                  },
                  children: [{ type: 'we-icon', props: { name: 'x' } }],
                },
              ],
            },
            {
              // The body scrolls, the header does not: a record with twenty fields must not push its own
              // type badge off the top of the panel.
              type: 'we-scroll-area',
              props: { flex: '1', width: '100%' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '400', width: '100%', px: '400', py: '400' },
                  children: [
                    { type: 'we-text', props: { variant: 'heading-sm' }, children: [{ $local: 'selected.label' }] },
                    actions,
                    cardStyle,
                    {
                      type: '$if',
                      props: {
                        condition: { $count: { items: { $local: 'selected.fields' } } },
                        then: {
                          type: 'Column',
                          props: { gap: '300', width: '100%' },
                          children: [
                            { type: 'we-divider' },
                            {
                              type: '$each',
                              props: { items: { $local: 'selected.fields' }, as: 'field' },
                              children: [fieldRow],
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  ],
};
