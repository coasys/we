import type { SchemaNode } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import { swatchRow } from './Palette';

/**
 * The board's key — what kinds of thing are on it, and what colour each one is.
 *
 * A legend that is also a control. Reading a board means knowing what the colours mean, and the
 * moment that is on screen the natural next thought is "make decisions amber" — so the key is where
 * the colour is *set*, not a caption describing a decision made somewhere else. It is also the only
 * surface that can say something about a type at all: the detail panel is about the card you
 * selected, and "every task on this board" has no card to select.
 *
 * ## Why it is toggleable rather than always there
 *
 * A board with three kinds of thing on it does not need a key, and a panel explaining what you can
 * already see is a panel covering the thing you are trying to look at. It opens on request and
 * remembers that per device — a preference rather than view state, since a link's recipient should
 * see the board, not somebody else's chrome.
 *
 * ## Where the list of types comes from
 *
 * The placements, ordered by type, with consecutive repeats suppressed — the `$prev` grouping
 * pattern, used for exactly what it is for. The schema layer has no "distinct", and the alternatives
 * were worse in ways that show: listing the space's models would name kinds that are not on this
 * board, and a store accessor would have to be told which board it was being asked about.
 *
 * That means the key lists what has been *placed*. A card sitting in the tray, put on the board but
 * never positioned, is not in it yet — which is consistent with the rest of the mode, where being
 * placed is what being on a board means.
 *
 * ## What this becomes
 *
 * Colour by type is the first rule and not the last: colour by task status, by author, by how
 * recently something changed. Each of those is a rule with a field and a mapping rather than one
 * colour per type, and this is the surface they belong on — which is why the record behind it is
 * called `TypeStyle` and lives on the board rather than being a colour field on the type.
 */

const BOARD = { $: 'local.boardId' };

/** The colour this type currently carries on this board, or empty. */
const colorOf = { $: 'find(local.boardTypeStyles, { nodeType: placement.nodeType }).color' };

const typeRow: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '100%' },
  children: [
    {
      /*
        The row opens its own palette.

        Per-row state held as a set of type names, because the rows come from data and a boolean
        field would need a name chosen when the template was written — the same reason the sidebar
        holds its collapsed groups this way.
      */
      type: 'we-button',
      props: {
        variant: 'bare',
        width: '100%',
        onClick: { $toggleLocalIn: 'openTypes', value: { $: 'placement.nodeType' } },
      },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', width: '100%' },
          children: [
            {
              type: 'Column',
              props: {
                width: '16px',
                height: '16px',
                r: '100',
                // Falls back to the neutral every unstyled card is drawn in, so the key never shows
                // a colour the board is not using.
                bg: expr`${colorOf} ? ${colorOf} : 'accent-muted'`,
                border: '1px solid border-strong',
              },
            },
            { type: 'we-text', props: { variant: 'label', truncate: true }, children: [{ $: 'placement.nodeType' }] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', ml: 'auto' },
              children: [{ $: 'count(filter(local.boardPlacements, { nodeType: placement.nodeType }))' }],
            },
            {
              type: 'we-icon',
              props: {
                size: 'xs',
                color: 'text-faint',
                name: { $: "placement.nodeType in local.openTypes ? 'caret-down' : 'caret-right'" },
              },
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'placement.nodeType in local.openTypes' },
        enterTransition: [
          { type: 'reveal', duration: 200 },
          { type: 'fade', duration: 150 },
        ],
        then: swatchRow({
          current: colorOf,
          pick: (token) => ({
            $action: 'recordStore.setTypeColor',
            args: [BOARD, { $: 'placement.nodeType' }, token],
            // The graph re-reads and merges, so every card of that type changes at once — which is
            // the whole point of colouring a type rather than a card.
            onSuccess: [{ $setLocal: 'revision', value: { $: 'local.revision + 1' } }],
          }),
        }),
      },
    },
  ],
};

/**
 * The key's dock: always mounted, on the right edge, and inert until something is in it.
 *
 * A `$if` with a transition wraps its content in an animation container positioned *from* that
 * content, so an absolutely positioned panel inside one is placed against the wrapper's box rather
 * than the canvas's. Docking it in a container that is always there and always where it says it is
 * takes the question away from the wrapper entirely.
 *
 * Right, because the detail panel took the left: the module rail runs down the right edge of the app
 * and overlaps whatever a route puts there, and of the two panels the key is the one that can afford
 * to lose a strip — it is read at a glance and dismissed, where the detail panel is worked in.
 *
 * `top` and `bottom` rather than a height, so the column is as tall as the canvas whatever resolves:
 * a percentage height needs an unbroken chain of resolved heights above it, and where that chain
 * breaks the panel is merely short, with its border stopping in mid-air.
 *
 * `pointerEvents: 'none'` because a 260px column down the side of the canvas would otherwise eat
 * every click on the board behind it while the key is closed; the panel inside turns them back on.
 */
export const boardLegend: SchemaNode = {
  type: 'Column',
  props: {
    position: 'absolute',
    top: '0',
    bottom: '0',
    right: '0',
    zIndex: 'chrome',
    pointerEvents: 'none',
  },
  children: [
    {
      type: '$if',
      props: {
        condition: expr`${BOARD} && local.legendOpen`,
        enterTransition: [
          { type: 'slide', direction: 'right', distance: '24px', duration: 180 },
          { type: 'fade', duration: 150 },
        ],
        then: {
          type: 'Column',
          /*
        Its own subscriptions, declared here rather than at the route.

        The panel is mounted only while it is open, so a board nobody asked a key about pays for
        neither query — and both are about the board this key is describing, which is the node they
        are declared on.
      */
          $queries: {
            boardPlacements: {
              entity: 'Placement',
              scope: { anchor: 'CollectionBlock', via: 'children', anchorId: BOARD },
              // Ordered by type, which is what makes the `$prev` grouping below yield each type once.
              order: { nodeType: 'asc' },
              limit: 200,
            },
            boardTypeStyles: {
              entity: 'TypeStyle',
              scope: { anchor: 'CollectionBlock', via: 'children', anchorId: BOARD },
              limit: 50,
            },
          },
          $localState: { openTypes: { type: 'array', initial: [] } },
          props: {
            height: '100%',
            width: '260px',
            maxWidth: '100%',
            // The same surface as the detail panel on the other edge, for the same reason: the
            // canvas paints its own `neutral-0`, so there is nothing lighter to be.
            bg: 'surface-raised',
            borderLeft: '1px solid border',
            shadow: 'lg',
            pointerEvents: 'auto',
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
                borderBottom: '1px solid border',
              },
              children: [
                { type: 'we-text', props: { variant: 'label' }, children: ['Key'] },
                {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    ml: 'auto',
                    onClick: { $setLocal: 'legendOpen', value: false },
                  },
                  children: [{ type: 'we-icon', props: { name: 'x' } }],
                },
              ],
            },
            {
              type: 'we-scroll-area',
              props: { flex: '1', width: '100%' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '300', width: '100%', px: '400', py: '400' },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'count(local.boardPlacements)' },
                        then: {
                          type: '$each',
                          props: { items: { $: 'local.boardPlacements' }, as: 'placement' },
                          children: [
                            {
                              /*
                                One row per *type*, from a list of placements.

                                The rows are ordered by type, so a row is the first of its kind exactly
                                when it differs from the one before it — the documented grouping trick,
                                and the only way to express "distinct" with the operators there are. The
                                first row has no `$prev`, so it always renders, which is correct.
                              */
                              type: '$if',
                              props: {
                                condition: { $: 'placement.nodeType != prev.nodeType' },
                                then: typeRow,
                              },
                            },
                          ],
                        },
                        else: {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-faint' },
                          children: ['Nothing placed on this board yet.'],
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
