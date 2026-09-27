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
 * - **The order.** By hand, by date either way, or by a reaction. Genuinely different questions — "what
 *   do we mean to do about it", "what came first" or "what is latest", "what do we most agree on" — and
 *   the first is the one the others cannot answer, which is why dragging imprints a rank rather than
 *   merely looking sorted.
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
  order: { type: 'string', initial: 'manual', syncParam: 'order' },
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
/**
 * Which reaction the order is reading, whether or not anybody has picked one.
 *
 * The picker falls back to the community's first type so it never shows an empty box — and that was the
 * whole of the bug: the *displayed* value fell back while `local.signalType` stayed empty, so "by
 * reaction" weighed nothing, ordered by date instead, and looked exactly like a sort that did not work.
 * A control showing a choice that is not in force is worse than one showing none.
 *
 * So the fallback is named once and every reader shares it: the picker's value, the test below, and the
 * weight the seed fetches. A local cannot be seeded from a subscription — `initial` is static and the
 * types arrive later — so the fallback has to live in the expression rather than in the declaration.
 */
const SIGNAL_IN_FORCE = `(local.signalType ? local.signalType : first(local.treeSignalTypes).id)`;

export const BY_SIGNAL = `(local.order == 'signal' && ${SIGNAL_IN_FORCE})`;

/**
 * Which card field the siblings are ordered by.
 *
 * `canvasRank` is the order somebody dragged, `weight` is what the reactions say, and `createdAt` is
 * the order things were said in — which is the state a canvas starts in rather than a mode anybody has
 * to choose, since a fresh canvas carries no ranks and nothing has been weighed.
 */
const SORT_FIELD = `(local.order == 'manual' ? 'canvasRank' : (${BY_SIGNAL} ? 'weight' : 'createdAt'))`;

/**
 * Strongest first; oldest or newest first, as asked.
 *
 * "Most agreed" belongs at the left of a row, and so does whichever end of time the reader asked for —
 * different numbers running different ways, so the direction follows the order rather than the field.
 * A dragged order is ascending because the rank *is* the position.
 */
const SORT_DIRECTION = `((${BY_SIGNAL} || local.order == 'newest') ? 'desc' : 'asc')`;

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
 * How each card is weighed, for the seed — whenever the tree is shown, and whenever the order is a
 * reaction, in either mode.
 *
 * Not only while ordering by a reaction, which is what it used to be, and why choosing "by reaction"
 * dimmed the whole canvas and redrew it: the weights were only asked for at the moment they were
 * needed, so the choice changed the seed and the graph reloaded. Read whenever the tree is up, they
 * are already there when the order changes, and "by reaction" is the same re-sort the other orders
 * are. Picking a different reaction still reads again — in the background, since `weigh` is one of
 * the canvas seed's `refreshOptions`, and the rows move when the new weights arrive.
 *
 * Kept on the freeform canvas while "by reaction" is the order chosen. A refresh replaces each card's
 * data wholesale, so turning the weights off there took them off the cards — and coming back to the tree
 * travelled into an order by date, then re-sorted once the weights were read again: two movements, the
 * first to an order nobody chose. Kept, they are on the cards when the tree comes back, and it travels
 * straight into the order the reader picked. The canvas pays for it only while that order is chosen;
 * otherwise it reads none, since nothing there is ordered.
 *
 * The community's own `aggregate` is passed through rather than worked out here, with the type's `mode`
 * beside it: the seed reads them by the rule every reaction surface uses (`aggregateFor`), under which a
 * stored `count` on a rating means its average — every type nobody set an aggregate for still carries
 * the manifest's default `count`. Without the mode a star rating ordered its cards by how many people
 * had rated them. `me` is the reader, so each card also says what they gave, for its reaction mark.
 *
 * Muted authors are left out, because every other reaction surface in WE leaves them out and this would
 * otherwise be the one place somebody a reader has muted still moves their cards about.
 */
export const TREE_WEIGH: SchemaProp = {
  $:
    `(${TREE_ON} || local.order == 'signal') && ${SIGNAL_IN_FORCE} ? { signalTypeId: ${SIGNAL_IN_FORCE},` +
    ` aggregate: find(local.treeSignalTypes, { id: ${SIGNAL_IN_FORCE} }).aggregate,` +
    ` mode: find(local.treeSignalTypes, { id: ${SIGNAL_IN_FORCE} }).mode,` +
    ` excludeAuthors: spaceStore.mutedDids, me: me.did } : null`,
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
 * When the tree is brought back into view: whenever its cards change size.
 *
 * Re-ordering a row keeps the camera where it is — a vote landing must not lurch the view — but bigger
 * cards make a bigger tree, and switching to large ones left cards off the screen. The graph centres
 * it again and zooms out only if it no longer fits, never in, so the size somebody picked is the size
 * they see. Only in the tree: on the freeform canvas every card has its own size and this picker is
 * not what sets it.
 */
export const TREE_REFRAME: SchemaProp = { $: `${TREE_ON} ? local.cardSize : ''` };

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
 *
 * A drag reorders siblings only while they are shown **as arranged**. Ordered by date or by reaction, a
 * card dragged along its row would slide into a place the order then takes back — so there it can still
 * move under another parent, and lands wherever that order puts it.
 *
 * `keep` mirrors the one refusal `arrangeOnTree` makes that the gesture cannot work out for itself: a card
 * whose connection to its parent has been commented on or reacted to is not taken out of its tree by a drag,
 * because that would delete the connection and everything said about it. The counts are on each line
 * already — the seed reads them for the cards — so the preview says so before the card is let go.
 */
export const TREE_BEHAVIOURS: SchemaProp = {
  $:
    `${TREE_ON} ? ['node-double-click', 'canvas-double-click', 'select',` +
    ` { type: 'arrange-nodes', options: { reorder: local.order == 'manual',` +
    ` keep: ['commentsCount', 'signalsCount'],` +
    ` keepReason: 'People have discussed this connection. Select the line itself to remove it.' } }, 'pan-zoom']` +
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
  /*
    Each card's score for the reaction the tree is ordered by, on its lower edge, pressed to give one's
    own — see `ReactionBadge`. Only while that is the order: under any other the number would be a
    ranking nobody asked to see, and the inspector already holds every reaction for the card selected.
  */
  badge: { $: `${TREE_ON} && ${BY_SIGNAL} ? 'reaction' : ''` },
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
 *
 * ## The spine keeps the canvas's own curve
 *
 * It was drawn with right angles here, on the reasoning that a reader follows a rank down an elbow
 * rather than across a curve. That is true of an org chart and wrong of this: the shape is the same
 * shape either way, and switching the line style as well as the arrangement makes the mode read as a
 * different *drawing* rather than as the same cards seen another way — which is the one thing a mode of
 * the canvas should not do. A line style is worth offering later, on its own, for both modes.
 */
export const TREE_EDGE_RULES: SchemaProp = {
  $:
    `${TREE_ON} ? [` +
    /*
      Every child hangs off the bottom of its parent and is met at its own top.

      Left to the geometry, a parent's three children get three different-looking relationships: the
      outer two spread sideways far enough that their left and right edges are the shortest path, and
      only the middle one is met at its top. They are the same relationship, and in a tree the
      arrangement is what carries that — so the rank has to read as one thing.

      `ignoreRoute` is the other half of the same sentence, and without it the rank still did not read as
      one thing: a line somebody had pulled to a card's left side on the canvas, or bent around something
      that is no longer in the way, kept doing both here. Those are decisions about one connection on one
      canvas, which is the narrower fact and wins everywhere the canvas is what is being read — and this is
      not that. Nothing is unwritten; going back to the canvas finds every one of them again, and the bend
      going away and coming back is animated rather than snapped.
    */
    `{ style: { sourceAnchor: 's', targetAnchor: 'n', ignoreRoute: true } },` +
    ` { when: { 'data.relationshipTypeId': { not: local.spine } },` +
    ` style: { opacity: 0.25, dashed: true, arrow: 'none' } }] : []`,
};

/**
 * The strip: the mode, and — once in it — what the shape is made of.
 *
 * The pickers are only drawn in tree mode because none of them means anything outside it, and a control
 * that is present and inert is worse than one that is absent: it invites a press and answers with
 * nothing. The mode button is always there, which is the other half of the same rule.
 */
export function treeStrip(opts: { below?: string } = {}): SchemaNode {
  /*
    Where the strip's top edge goes.

    `below` is the line the surrounding chrome ends at, which the caller knows and this does not: on the
    workshop it is the pinned pill bar, whose height is an expression over the control-height token and
    a theme's offset to it. Without it the strip sat at the container's own top corner — *underneath* the
    call pill and the undo/redo pills, which are `position: fixed` over the whole route. The controls
    rendered perfectly, measured correctly and could not be seen or pressed.

    Absent means the corner, which is right for a canvas with nothing pinned over it.
  */
  const top = opts.below ? `calc(${opts.below} + var(--we-space-300))` : 'var(--we-space-300)';
  return {
    type: 'Row',
    props: {
      /*
        Pinned to the corner with `top`/`left` rather than nudged with `x`/`y`.

        The design system prefers the transform pair for anything in flow, because those respond to a
        breakpoint and compose with rotation. This is not in flow: it is an overlay whose whole
        instruction is "that corner, that far in", and `top` is the property that says so. A transform
        would say "this far from wherever you would otherwise have been", which for an absolutely
        positioned child of a flex container is the content-box origin — the same place, arrived at less
        directly and unclamped by the box.
      */
      position: 'absolute',
      top,
      /*
        A plain token, where the pills beside it need `--we-chrome-left`.

        They are `position: fixed`, so they resolve against the viewport and have to add back the
        sidebar and any left-hand dock themselves. This is `absolute` inside the route, which the shell
        has already inset by both — so the same visual gap is the bare token, and reading the chrome
        variable here would push the strip in by the sidebar's width twice.
      */
      left: '300',
      // Above the graph's own layers. The graph is `position: relative` with no stacking of its own, so
      // a later sibling would paint over it anyway; stated because the reason it works is not visible.
      zIndex: 2,
      p: '200',
      gap: '200',
      ay: 'center',
      wrap: true,
      bg: 'surface-raised',
      r: 'surface',
      border: '1px solid border',
      shadow: 'sm',
      // The inset on each side, so a wrapped strip never runs off a narrow canvas.
      maxWidth: 'calc(100% - 2 * var(--we-space-300))',
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
          /*
            No transition on the pickers, and that is a fix rather than an omission.

            A `reveal` on the inline axis animates the group's width from nothing to its natural size —
            and the strip wraps, so a group growing through the available width pushes the last control
            onto a second line and then pulls it back. The strip visibly doubled in height and shrank
            again, in the middle of the one moment that already has every card moving. The mode switch
            is the animation; its controls should simply be there.
          */
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
                    { label: 'As arranged', value: 'manual' },
                    { label: 'Oldest first', value: 'date' },
                    { label: 'Newest first', value: 'newest' },
                    { label: 'By reaction', value: 'signal' },
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
                      value: { $: SIGNAL_IN_FORCE },
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
