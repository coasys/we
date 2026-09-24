/**
 * Reading the canvas as a tree.
 *
 * The same cards, the same connections, the same records — arranged by what they say about each other
 * rather than by where somebody dropped them. Freeform is where a conversation's output *lands*; a
 * tree is where a group works out what follows from what, and which of several things they most agree
 * about. Both are readings of one dataset, which is why this is a mode of the canvas rather than a
 * second surface: switching must not cost the arrangement, and it does not — the placements are
 * untouched, so coming back finds every card exactly where it was left.
 *
 * ## Four controls, and why each exists
 *
 * - **The mode.** In the address (`?tree=1`), so a link carries the reading. A reader who sends
 *   somebody "look at this" means the shape they are looking at.
 * - **The spine.** A canvas's connections are a general graph: a card may be related to several others
 *   in several ways, and nothing in the data says which of those makes a *parent*. So a tree is always
 *   "follow this one kind", chosen from the kinds this community has named. Also in the address, for
 *   the same reason.
 * - **The order.** By date, by a reaction, or by hand. Three genuinely different questions — "what came
 *   first", "what do we most agree on", "what do we mean to do about it" — and the third is the one the
 *   other two cannot answer, which is why dragging imprints a rank rather than merely looking sorted.
 * - **The card size.** A reading preference rather than view state, so it is kept on the device and a
 *   shared link does not impose it: a forty-card tree wants smaller cards than a six-card one, and that
 *   is about the screen somebody is at.
 *
 * ## Where the strip sits, and why it is not in the key
 *
 * The key panel answers "what do the colours mean". This answers "how is the canvas arranged", which
 * is a different question, and the key's own header says as much. A panel is the other obvious home and
 * is wrong for one reason that decides it: a panel can be closed, and the engine's own rule is that a
 * state the layout obeys has to be visible and reversible. A reader who closed the panel would be left
 * in a mode with nothing on screen offering the way out.
 *
 * So it is a compact strip in the canvas's own corner — which is also the objection an earlier chip
 * there earned, and the difference is worth stating: that chip *reported* something the key already
 * said, where this is the only control for a state nothing else can change.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/** The box a card is given in each reading size, in world units. Post-it proportions throughout. */
const CARD_SIZES: Record<string, { width: number; height: number }> = {
  sm: { width: 120, height: 90 },
  md: { width: 180, height: 135 },
  lg: { width: 260, height: 195 },
};

/** What the freeform canvas parks an unplaced card in, and the size a tree card falls back to. */
export const CANVAS_CARD = CARD_SIZES.md;

/**
 * The locals the canvas route declares for this.
 *
 * `treeMode`, `spine` and `order` are **view state**: send the address to somebody and they should see
 * the shape you are looking at. `signalType` travels with `order` for the same reason — "ranked by
 * agreement" is not the same picture as "ranked by importance".
 *
 * `cardSize` is a **preference**, kept on the device: it is about the screen somebody is sitting at,
 * and a link that shrank the recipient's cards would be imposing a decision that was never about them.
 */
export const TREE_LOCALS = {
  treeMode: { type: 'boolean', initial: false, syncParam: { name: 'tree', push: true } },
  spine: { type: 'string', initial: '', syncParam: 'spine' },
  order: { type: 'string', initial: 'date', syncParam: 'order' },
  signalType: { type: 'string', initial: '', syncParam: 'by' },
  cardSize: { type: 'string', initial: 'md', persist: 'workshop.treeCardSize' },
} as const;

/**
 * The two vocabularies the strip picks from.
 *
 * Both subscribed, because a community names a kind of connection or a kind of reaction while people
 * are looking at the canvas — that is what the vocabulary settings are for — and a picker that had to
 * be reloaded to offer one would make the new word look like it had not saved.
 */
export const TREE_QUERIES = {
  relationshipKinds: { entity: 'RelationshipType', order: { name: 'asc' }, subscribe: true },
  treeSignalTypes: { entity: 'SignalType', order: { name: 'asc' }, subscribe: true },
} as const;

export const TREE_ON = 'local.treeMode';

/** The spine, as the `forest` layout names one: one field of a line, and the value it must hold. */
const SPINE_SELECTOR = `{ field: 'data.relationshipTypeId', value: local.spine }`;

/** Whether the order in force is one a reaction decides — which is also when a weight is worth fetching. */
export const BY_SIGNAL = `(local.order == 'signal' && local.signalType)`;

/**
 * Which card field the siblings are ordered by.
 *
 * `canvasRank` is the order somebody dragged, `weight` is what the reactions say, and `createdAt` is
 * the order things were said in — which is the state a canvas starts in rather than a mode anybody has
 * to choose, since a fresh canvas carries no ranks and nothing has been weighed.
 */
const SORT_FIELD = `(local.order == 'manual' ? 'canvasRank' : (${BY_SIGNAL} ? 'weight' : 'createdAt'))`;

/**
 * Strongest first, oldest first.
 *
 * The two read in opposite directions and both are what people mean: "most agreed" belongs at the left
 * of a row and "said first" belongs at the left of a row, and those are different numbers running
 * different ways. A dragged order is ascending because the rank *is* the position.
 */
const SORT_DIRECTION = `(${BY_SIGNAL} ? 'desc' : 'asc')`;

/**
 * A box as the expression grammar spells an object literal — bare keys, not JSON.
 *
 * `JSON.stringify` would emit `{"width":180}`, and a quoted key is not the grammar's spelling of one.
 * It happens to parse, which is exactly why writing it that way is a trap: the schema validates, and
 * the day the parser is tightened every card on the canvas silently loses its size.
 */
const box = (size: { width: number; height: number }) => `{ width: ${size.width}, height: ${size.height} }`;

const CARD_BOX = `(local.cardSize == 'sm' ? ${box(CARD_SIZES.sm)} : (local.cardSize == 'lg' ? ${box(CARD_SIZES.lg)} : ${box(CARD_SIZES.md)}))`;

/**
 * How each card is weighed, for the seed — or nothing, when the order does not depend on reactions.
 *
 * The community's own `aggregate` is passed through rather than worked out here. That rule lives with
 * the vocabulary — a toggle counts, a vote nets out, a rating averages — and a second copy of it in a
 * template is the copy that falls behind: it would go on netting out a type somebody had switched to
 * averaging, and nothing on screen would say why the order looked wrong.
 *
 * Muted authors are left out, because every other reaction surface in WE leaves them out and this would
 * otherwise be the one place somebody a reader has muted still moves their cards about.
 */
export const TREE_WEIGH: SchemaProp = {
  $:
    `${BY_SIGNAL} ? { signalTypeId: local.signalType,` +
    ` aggregate: find(local.treeSignalTypes, { id: local.signalType }).aggregate,` +
    ` excludeAuthors: spaceStore.mutedDids } : null`,
};

/**
 * The layout, either way.
 *
 * One expression rather than two graphs. The engine rearranges what is already loaded on a layout
 * change and travels the cards to their new places, so the switch is one movement over one set of
 * cards — where two `GraphView`s would unmount one and mount the other, throwing away the selection,
 * the camera and every card's identity in the process.
 */
export const TREE_LAYOUT: SchemaProp = {
  $:
    `${TREE_ON} ? { type: 'forest', options: { spine: ${SPINE_SELECTOR}, sortBy: ${SORT_FIELD},` +
    ` sortDirection: ${SORT_DIRECTION}, card: ${CARD_BOX}, unattachedLabel: 'Unconnected' } }` +
    ` : { type: 'manual', options: { size: ${box(CANVAS_CARD)},` +
    ` widthField: 'canvasWidth', heightField: 'canvasHeight' } }`,
};

/**
 * The gestures, either way.
 *
 * `arrange-nodes` replaces `drag-node` rather than joining it: both claim a press on a card, so listing
 * the two would have whichever came first win, and the winner would be the wrong one in one of the two
 * modes. `select` stays ahead of both, exactly as it does on the freeform canvas — it does not claim
 * the press, and it needs to see it to know what a release means.
 *
 * `marquee-select` is dropped in tree mode. A rectangle over an arrangement nobody chose selects
 * whatever the layout happened to put in it, which is a set with no meaning; and the thing a reader
 * wants a selection *for* on a canvas is moving cards together, which a tree does not do.
 */
export const TREE_BEHAVIOURS: SchemaProp = {
  $:
    `${TREE_ON} ? ['node-double-click', 'canvas-double-click', 'select', 'arrange-nodes', 'pan-zoom']` +
    ` : ['node-double-click', 'canvas-double-click', 'marquee-select', 'select',` +
    ` { type: 'drag-node', options: { pin: true } }, 'pan-zoom']`,
};

/**
 * A card's box: uniform in a tree, its own on the canvas.
 *
 * Uniform deliberately, and it is the decision that makes a tree readable. A rank reads as
 * significance, so cards at the sizes somebody chose while arranging a wall would claim an importance
 * the data does not support — the widest card on a row would look like the answer whatever its weight.
 * What survives is colour, which in this space is meaning, and the counts, which are what say *why* an
 * order is the order it is.
 *
 * Expressed as a value that is either a number or a field reference, which is what lets one rule serve
 * both modes: a reference the card cannot answer contributes nothing and falls through to the rule
 * above, so a card with no size of its own is unaffected either way.
 */
export const TREE_CARD_STYLE = {
  width: { $: `${TREE_ON} ? (${CARD_BOX}).width : { from: 'data.canvasWidth' }` },
  height: { $: `${TREE_ON} ? (${CARD_BOX}).height : { from: 'data.canvasHeight' }` },
  cardShape: { $: `${TREE_ON} ? 'note' : { from: 'data.canvasCardShape' }` },
  contentScale: { $: `${TREE_ON} ? 1 : { from: 'data.canvasContentScale' }` },
  // Stacking is meaningless where nothing overlaps, and a card sent behind on the canvas must not be
  // behind anything here — there is nothing for it to be behind.
  z: { $: `${TREE_ON} ? 0 : { from: 'data.canvasZ' }` },
};

/**
 * The connections a tree is NOT following, drawn faint.
 *
 * Kept rather than hidden, and this is the honest half of placing each card under one parent. A card
 * related to two others by the spine sits under one of them; the other claim is still true and is
 * still drawn, so nothing is lost — and a connection of another kind entirely ("contradicts", while
 * the spine is "supports") is exactly the thing a reader following a decision pathway wants to notice.
 *
 * Faint rather than absent because a tree with every other line at full strength is a tangle, and the
 * lines that make the shape have to be the ones the eye follows first.
 */
export const TREE_EDGE_RULES = [
  {
    when: { $: `${TREE_ON} ? { 'data.relationshipTypeId': { not: local.spine } } : { 'data.__none': true }` },
    style: { opacity: 0.25, dashed: true, arrow: 'none' },
  },
  {
    when: { $: `${TREE_ON} ? { 'data.relationshipTypeId': local.spine } : { 'data.__none': true }` },
    // Right angles, which is what a reader follows down a rank rather than across a curve.
    style: { curve: 'step' },
  },
];

/**
 * The strip: the mode, and — once in it — what the shape is made of.
 *
 * The pickers are only drawn in tree mode because none of them means anything outside it, and a control
 * that is present and inert is worse than one that is absent: it invites a press and answers with
 * nothing. The mode button is always there, which is the other half of the same rule.
 */
export function treeStrip(): SchemaNode {
  return {
    type: 'Row',
    props: {
      position: 'absolute',
      zIndex: 2,
      m: '300',
      p: '200',
      gap: '200',
      ay: 'center',
      wrap: true,
      bg: 'surface-raised',
      r: 'surface',
      border: '1px solid border',
      shadow: 'sm',
      maxWidth: 'calc(100% - var(--we-space-600))',
    },
    children: [
      /*
        One button, not a pair of tabs.

        The state is binary and the button says which reading it will give you — "Tree" while you are on
        the canvas, "Canvas" while you are in the tree. A segmented control would spend twice the room
        to say the same thing, in a strip that has to leave the canvas visible.
      */
      {
        type: 'we-button',
        props: {
          size: 'sm',
          variant: { $: `${TREE_ON} ? 'secondary' : 'ghost'` },
          title: { $: `${TREE_ON} ? 'Back to the freeform canvas' : 'Arrange these cards as a tree'` },
          onClick: { $toggleLocal: 'treeMode' },
        },
        children: [
          { type: 'we-icon', props: { name: { $: `${TREE_ON} ? 'graph' : 'tree-structure'` } } },
          { type: 'we-text', props: { variant: 'label' }, children: [{ $: `${TREE_ON} ? 'Canvas' : 'Tree'` }] },
        ],
      },
      {
        type: '$if',
        props: {
          condition: { $: TREE_ON },
          enterTransition: [
            { type: 'reveal', axis: 'inline', duration: 200 },
            { type: 'fade', duration: 150 },
          ],
          then: {
            type: 'Row',
            props: { gap: '200', ay: 'center', wrap: true },
            children: [
              { type: 'we-divider', props: { orientation: 'vertical', height: '20px' } },
              /*
                Which connection makes a parent.

                Empty is a real answer and the one a space starts at: with no kind chosen the layout
                follows every line, which is right for a canvas whose connections are all one kind and
                is the thing to try first.

                **The unset state is the placeholder, and the way back to it is a button.** A schema
                cannot prepend an "Any connection" row to a mapped list — two lists inside a template
                literal evaluate to a *string*, so the select would render with nothing in it at all —
                and that spelling was live in the record form's own kind picker for exactly as long as
                nobody noticed the picker was empty. `showcase.test.ts` guards against it.
              */
              {
                type: 'we-select',
                props: {
                  size: 'sm',
                  fit: true,
                  placeholder: 'Any connection',
                  value: { $: 'local.spine' },
                  options: { $: 'local.relationshipKinds.map(k, { label: k.name, value: k.id })' },
                  onChange: { $setLocal: 'spine', value: { $: 'event.detail' } },
                },
              },
              {
                type: '$if',
                props: {
                  condition: { $: 'local.spine' },
                  then: {
                    type: 'we-button',
                    props: {
                      size: 'sm',
                      variant: 'ghost',
                      square: true,
                      title: 'Follow every kind of connection',
                      onClick: { $setLocal: 'spine', value: '' },
                    },
                    children: [{ type: 'we-icon', props: { name: 'x' } }],
                  },
                },
              },
              {
                type: 'we-select',
                props: {
                  size: 'sm',
                  fit: true,
                  value: { $: 'local.order' },
                  options: [
                    { label: 'Oldest first', value: 'date' },
                    { label: 'By reaction', value: 'signal' },
                    { label: 'As arranged', value: 'manual' },
                  ],
                  onChange: { $setLocal: 'order', value: { $: 'event.detail' } },
                },
              },
              /*
                Which reaction, and only while one is what the order depends on.

                It defaults to the first type the community has rather than to nothing: "By reaction"
                with no reaction picked is a state that looks like an order and is not one, and the
                order it would actually give — by date — contradicts the control saying otherwise.
              */
              {
                type: '$if',
                props: {
                  condition: { $: "local.order == 'signal'" },
                  then: {
                    type: 'we-select',
                    props: {
                      size: 'sm',
                      fit: true,
                      value: { $: 'local.signalType ? local.signalType : first(local.treeSignalTypes).id' },
                      options: {
                        $: 'local.treeSignalTypes.map(t, { label: t.name, value: t.id })',
                      },
                      onChange: { $setLocal: 'signalType', value: { $: 'event.detail' } },
                    },
                  },
                },
              },
              { type: 'we-divider', props: { orientation: 'vertical', height: '20px' } },
              {
                type: 'we-select',
                props: {
                  size: 'sm',
                  fit: true,
                  value: { $: 'local.cardSize' },
                  options: [
                    { label: 'Small cards', value: 'sm' },
                    { label: 'Medium cards', value: 'md' },
                    { label: 'Large cards', value: 'lg' },
                  ],
                  onChange: { $setLocal: 'cardSize', value: { $: 'event.detail' } },
                },
              },
            ],
          },
        },
      },
    ],
  };
}
