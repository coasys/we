import type { SchemaNode } from '@we/schema-shared';

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
 * What the graph is being asked to open, derived rather than stored.
 *
 * `$setLocal`'s `value` is a literal — a token inside it is stored as the token — so a button
 * cannot write `{ id: <the selected node> }` directly. It writes which *kind* of expansion was
 * asked for, and the request is composed here from that plus whatever is selected.
 */
export const expandRequest = {
  $if: {
    condition: { $local: 'expandKind' },
    then: { id: { $local: 'selected.id' }, expanders: [{ $local: 'expandKind' }] },
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

/** One field: the name above the value, which is the whole reason this is a column. */
const fieldRow: SchemaNode = {
  type: 'Column',
  props: { gap: '100', width: '100%' },
  children: [
    { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: ['$field.name'] },
    { type: 'we-text', props: { variant: 'body' }, children: ['$field.value'] },
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
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true, width: '100%' },
          children: [openButton('Relations', 'graph', 'entity'), openButton('Fields', 'list-bullets', 'property')],
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
                  children: [{ type: 'we-icon', props: { name: 'x-circle' } }, 'Remove'],
                },
              },
            },
          ],
        },
      ],
    },
  },
};

export const nodeDetailPanel: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: [{ $local: 'selected' }, { $not: { $local: 'panelClosed' } }] },
    // Sliding in from the edge it is docked to, so it reads as arriving rather than appearing.
    enterTransition: [
      { type: 'slide', direction: 'left', distance: '24px', duration: 180 },
      { type: 'fade', duration: 150 },
    ],
    then: {
      type: 'Column',
      props: {
        position: 'absolute',
        top: '0',
        right: '0',
        height: '100%',
        width: '320px',
        maxWidth: '100%',
        bg: 'neutral-0',
        borderLeft: '1px solid neutral-200',
        shadow: 'lg',
        zIndex: 'chrome',
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
};
