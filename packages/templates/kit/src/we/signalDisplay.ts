import type { SchemaNode } from '@we/schema-shared';

import { createSignalTypeModal } from './signalTypeForm.ts';
import { HAS_OFFERED_SIGNAL_TYPES, OFFERED_SIGNAL_TYPES } from './signalTypes.ts';

/**
 * Every reaction on a record, at whichever density the surface has room for.
 *
 * ## Three modes, and why they are a closed set
 *
 * A community can define as many kinds of reaction as it likes — a like, a five-star rating, an
 * up/down vote, a slider — and every surface in the app has to draw them in whatever room it has.
 * Left to each surface that produces a variant per surface, which is exactly how the comment count
 * in the cards feed came out a different size and colour from the hearts beside it.
 *
 * So the density is a choice from three, named here and picked by the caller:
 *
 * - **`total`** — one mark and how many people reacted, whatever they reacted with. Pressing it
 *   opens the modal, which is `full` in a sheet. For a row that has space for one thing.
 * - **`compact`** — one mark and its own number per type. A toggle presses straight through; every
 *   other kind opens its real control in a popover. For a card, a feed row, a reply.
 * - **`full`** — every type the community offers, as its own control. For a panel somebody opened
 *   deliberately, where the vocabulary should be discoverable rather than merely usable.
 *
 * The mode never changes itself. A surface that became a modal-opener because a community added a
 * second reaction would be a layout changing under the reader with no author's decision behind it;
 * crowding is answered by `max` and an overflow into the modal, which keeps the shape the author
 * chose.
 *
 * Every mode that hides anything carries a way to the rest — `total` is one press, and `compact`
 * grows a plus the moment there is a type it is not drawing. That is not a nicety: `compact`
 * defaults `showUnused` off, so without it a community's vocabulary is hidden by a display with
 * nothing to open it.
 *
 * ## Why a fragment and not a component
 *
 * Which types, in what order, with what around them is arrangement, and arrangement stays data.
 * Everything below it that must *do* something is already a component or a primitive: `CountMark`
 * draws the mark and its number, `SignalControl` is one type's real input, `we-popover` and
 * `we-modal` own the browser work. The number each mark shows is `signalTally`, a host function, so
 * a compact display needs no component of its own — which is the point, since a mode that needed
 * one would be a mode somebody re-implements the next time a surface is slightly different.
 *
 * ## Ambient scope
 *
 * - **`local.signalTypes`** — a hoisted `{ entity: 'SignalType', subscribe: true }`, declared on the
 *   node that renders the list rather than per row. One subscription for a panel, not one per card.
 * - **`<record>.signals`, hydrated** — `include: { signals: true }` on the query that fetched the
 *   record. Without it the relation arrives as ids, every filter matches nothing, and every count
 *   reads zero while the reactions are plainly there.
 */
export interface SignalDisplayOptions {
  /** Context key of the record being reacted to — `'row'`, `'link'`, `'card'`. */
  record: string;
  /** How much room this surface has. Defaults to `full`. */
  mode?: 'total' | 'compact' | 'full';
  /** How big each control is drawn. Defaults to `md`. */
  size?: 'xs' | 'sm' | 'md';
  /**
   * Show types nobody has used on this record yet.
   *
   * Defaults to true in `full` and false elsewhere, which is the split the surfaces want: a panel
   * is where a community's vocabulary should be discoverable, and a card is not the place to learn
   * that six kinds of reaction exist. Where it is off, the modal is how the rest are reached — which
   * is why `total` and `compact` both lead there, at every count and not only when crowded.
   */
  showUnused?: boolean;
  /**
   * Draw only. For a card that is dragged rather than operated: a row of live controls on something
   * whose gesture is "pick me up" is furniture competing with the thing the card is for.
   */
  readOnly?: boolean;
  /**
   * Marks before the rest go behind the plus, in `compact`. Defaults to 4.
   *
   * This rather than switching mode on type count: an author picked `compact` because of the room
   * the surface has, and that does not stop being true when a community names a fifth reaction.
   *
   * The plus is there whether or not this limit bites — it is how an unused type is reached too —
   * and carries the number only when marks were really dropped. See `compactRow`.
   */
  max?: number;
  /** Context key bound per signal type. Defaults to `'sig'`; change it inside another `$each`. */
  as?: string;
  /** What to draw where the community has defined no reactions at all. Omit for nothing. */
  empty?: SchemaNode;
  /** Sit among other controls rather than owning the line — no full width, no height floor. */
  inline?: boolean;
}

/** Local holding whether this record's reactions modal is up. Declared on the fragment's own root. */
const MODAL_OPEN = 'signalsModalOpen';

/**
 * The same, for the form that defines a new reaction type.
 *
 * Declared on the root beside `MODAL_OPEN` rather than inside either surface that offers it, since
 * `newType` is rendered both by `fullRow` and by the sheet. A `$setLocal` with no declaring
 * ancestor warns and no-ops: the button renders, takes the click, and does nothing.
 */
const NEW_TYPE_OPEN = 'signalTypeFormOpen';

/**
 * The options with every default already applied.
 *
 * Every helper below takes this rather than the caller's options, and that is not tidiness. The
 * mode's default was applied at the entry point while `typesShown` read `opts.mode` directly — so a
 * caller writing `signalDisplay({ record })`, which means `full`, was answered as though the mode
 * were unset, and `full` hid the unused types it exists to show. Every panel in the app called it
 * that way. Resolving once is what makes a default a default everywhere rather than in the one
 * place that remembered to ask.
 */
type Resolved = SignalDisplayOptions & { mode: NonNullable<SignalDisplayOptions['mode']>; as: string };

/**
 * One type's signals here, less the ones from agents this reader has muted — and with this agent's
 * own newest answer in place whether or not it has been read back yet.
 *
 * Through `reactions`, which is the overlay every reaction surface draws from. A press writes a
 * record and the subscription answers about a second later, with the executor's own 250ms debounce
 * under that; without the overlay the glyph stays unfilled and the count stays put, and the press
 * reads as having failed.
 *
 * Wrapped HERE rather than at each use, so the number, the mark's "is this mine", and the control's
 * filled star all come off one list and cannot disagree — which is exactly what happened when only
 * the count was overlaid and the heart sat unfilled beside a number that had moved.
 */
const forType = (record: string, as: string) =>
  `reactions({ signals: filter(${record}.signals, { signalTypeId: ${as}.id, author: { not: spaceStore.mutedDids } }), record: ${record}.id, type: ${as}.id, me: me.did })`;

/**
 * Everything on the record, less muted authors — what the single total counts.
 *
 * Not overlaid, and that is not an oversight. `reactions` stands in for this agent's answer for ONE
 * type; a total spans every type at once, so there is no single hold that answers for it. The number
 * it shows is how many people reacted at all, which a press only changes when it is somebody's first
 * reaction of any kind on that record — the rarest case, and the one where being a round trip late
 * costs least. Overlaying it properly means holding per record as well as per type, which is a
 * second mechanism for a number nobody is watching that closely.
 */
const everything = (record: string) => `filter(${record}.signals, { author: { not: spaceStore.mutedDids } })`;

/**
 * Whether this agent has reacted with this type. What makes a mark read as "mine".
 *
 * Off the overlaid list, not the raw one: a heart that fills a second after its count moves reads
 * as somebody else's reaction arriving rather than as your own registering.
 */
const mineOfType = (record: string, as: string) => `count(filter(${forType(record, as)}, { author: me.did }))`;

/**
 * The types this display draws, which is the whole of what `showUnused` decides.
 *
 * `filter(…, {}, max)` keeps the first N — the same limit the overflow counts against, so the two
 * cannot disagree about which marks are shown.
 */
function typesShown(opts: Resolved, limit?: number): string {
  const used = `${OFFERED_SIGNAL_TYPES}.filter(t, count(filter(${opts.record}.signals, { signalTypeId: t.id, author: { not: spaceStore.mutedDids } })))`;
  const all = (opts.showUnused ?? opts.mode === 'full') ? OFFERED_SIGNAL_TYPES : used;
  return limit === undefined ? all : `filter(${all}, {}, ${limit})`;
}

/**
 * What a type means here, as a name and the community's own sentence about it.
 *
 * A reaction's glyph is a heart or a star and its meaning is whatever the community decided — which
 * is written down in the type's description and, until this, shown nowhere a reader would look. The
 * bubble carries both because the name alone rarely settles it: two spaces can both have a "star"
 * and mean quite different things by it.
 *
 * A native `div` carries the slot assignment, and it has to be a native one: `slot` is spread onto
 * whatever the node renders, so on a layer-4 component like `Column` it arrives as a prop and is
 * dropped — the content then falls into the tooltip's *default* slot beside the trigger and renders
 * as permanently visible chrome. See `peopleTooltip`, which learned this first.
 */
function meaning(as: string, children: SchemaNode[]): SchemaNode {
  return {
    type: 'we-tooltip',
    children: [
      {
        type: 'div',
        slot: 'content',
        children: [
          {
            type: 'Column',
            props: { gap: '100', textAlign: 'left' },
            children: [
              { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: `${as}.name` }] },
              {
                type: '$if',
                props: {
                  condition: { $: `${as}.description` },
                  then: {
                    type: 'we-text',
                    props: { variant: 'footnote' },
                    children: [{ $: `${as}.description` }],
                  },
                },
              },
            ],
          },
        ],
      },
      ...children,
    ],
  };
}

/** One type's real control, as the panel and the popover both draw it. */
function control(opts: Resolved, as: string): SchemaNode {
  return {
    type: 'SignalControl',
    props: {
      ...(opts.size && { size: opts.size }),
      signalType: { $: as },
      signals: { $: forType(opts.record, as) },
      myDid: { $: 'me.did' },
      ...(opts.readOnly
        ? {}
        : {
            onSignal: {
              $action: 'spaceStore.upsertSignal',
              args: [{ $: `${opts.record}.id` }, { $: `${as}.id` }, { $: 'arg' }],
            },
          }),
    },
  };
}

/**
 * One type as a mark and its number.
 *
 * A toggle presses straight through, because a toggle's real control IS a mark — opening a popover
 * to show the same heart again would be a door in front of a doorway. Every other kind opens its
 * control in a popover: a rating is five stars whose arrangement is the reading, a vote has two
 * ends, a slider is a track. None of those survives being collapsed to one press.
 *
 * `we-popover` owns whether it is open — a click on its trigger toggles it — so this needs no local
 * and two marks on one row cannot disagree about which is showing.
 */
function mark(opts: Resolved, as: string): SchemaNode {
  const pressable = !opts.readOnly;
  const markNode = (press: boolean): SchemaNode => ({
    type: 'CountMark',
    props: {
      icon: { $: `${as}.icon` },
      count: { $: `signalTally({ signals: ${forType(opts.record, as)}, type: ${as} })` },
      mine: { $: mineOfType(opts.record, as) },
      ...(opts.size && { size: opts.size }),
      label: { $: `${as}.name` },
      ...(press && pressable
        ? {
            onPress: {
              $action: 'spaceStore.upsertSignal',
              // A toggle is on or off, so its press is its whole vocabulary: give the type's top of
              // range, or take it back. `arg` is not available — nothing emitted a value.
              args: [
                { $: `${opts.record}.id` },
                { $: `${as}.id` },
                { $: `${mineOfType(opts.record, as)} ? 0 : ${as}.rangeMax` },
              ],
            },
          }
        : {}),
    },
  });

  return {
    type: '$if',
    props: {
      condition: { $: `${as}.mode == 'toggle'` },
      then: meaning(as, [markNode(true)]),
      else: {
        type: 'we-popover',
        props: { placement: 'top' },
        children: [
          { type: 'div', slot: 'trigger', children: [meaning(as, [markNode(false)])] },
          {
            type: 'div',
            slot: 'content',
            children: [
              {
                type: 'Column',
                props: { bg: 'surface-raised', r: 'surface', p: '400', gap: '200', shadow: 'lg' },
                children: [
                  { type: 'we-text', props: { variant: 'label' }, children: [{ $: `${as}.name` }] },
                  control(opts, as),
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Every type the community offers, as its own control — the surface a reaction is *given* on.
 *
 * All of them by default, whether or not anybody has used them, which is the difference from a card
 * and the reason this mode exists: a type a community defined and nobody has used yet is exactly the
 * one that needs a control, and hiding it leaves a vocabulary unreachable from every surface at once.
 *
 * ## A row among other things, or a list that owns the space — which is what `inline` already meant
 *
 * `inline` is the caller saying whether this display sits among other controls or owns its line, and
 * the two want genuinely different layouts rather than the same one with more padding.
 *
 * **Inline** is a wrapping row of bare controls, for a card's footer beside a comment count. The
 * names live in tooltips because there is no room to write them.
 *
 * **Owning the line** is a list, one type per row, each with its name and the community's own
 * sentence about it beside its control. A wrapping row in a panel blurs four types into one strip —
 * a heart, some stars, two arrows and a slider running together with nothing saying where one ends
 * and the next begins, and a slider in particular has no room to be dragged. A panel is also where
 * somebody is *reading* the vocabulary rather than reaching past it, so the words belong on screen
 * and the tooltip goes: `meaning` exists to say in a bubble what there was no room to write, and
 * here there is room.
 *
 * The sheet is this layout too, which is why it no longer has one of its own.
 */
function fullRow(opts: Resolved, as: string): SchemaNode {
  if (!opts.inline) return fullList(opts, as);
  return {
    /*
      Wrapping, and a floor under its height.

      A community may offer five types and a card is 320px wide, so the row wraps rather than
      pushing the card's own scroll sideways. The floor is what stops the section appearing a frame
      late and shoving everything below it down: the controls are buttons, which have a height the
      moment they exist and none before the subscription answers.
    */
    type: 'Row',
    props: { gap: opts.size === 'xs' ? '300' : '400', ay: 'center', wrap: true },
    children: [
      {
        type: '$each',
        props: { items: { $: typesShown(opts) }, as },
        children: [meaning(as, [control(opts, as)])],
      },
      // And a way to mean something the community has no reaction for yet — see `newType`.
      ...newType(opts, { labelled: false }),
    ],
  };
}

/** One type per row, each saying what it is — see `fullRow` for when this is the shape. */
function fullList(opts: Resolved, as: string): SchemaNode {
  return {
    type: 'Column',
    // The floor is `fullRow`'s, for the same reason: the section must not appear a frame late and
    // shove everything under it down once the subscription answers.
    props: { width: '100%', gap: '400', minHeight: '40px' },
    children: [
      {
        type: '$each',
        props: { items: { $: typesShown(opts) }, as },
        children: [
          {
            type: 'Row',
            props: { width: '100%', ay: 'center', gap: '400' },
            children: [
              {
                // Takes the room and gives it up: a long description wraps rather than pushing the
                // control off the edge.
                type: 'Column',
                props: { flex: '1 1 auto', minWidth: '0', gap: '100' },
                children: [
                  { type: 'we-text', props: { variant: 'label' }, children: [{ $: `${as}.name` }] },
                  {
                    type: '$if',
                    props: {
                      condition: { $: `${as}.description` },
                      then: {
                        type: 'we-text',
                        props: { fontSize: '100', color: 'text-muted' },
                        children: [{ $: `${as}.description` }],
                      },
                    },
                  },
                ],
              },
              // Never absorbs somebody else's overflow: a rating is five glyphs and a slider is a
              // track, and neither has a narrower form worth having.
              { type: 'Row', props: { flex: '0 0 auto' }, children: [control(opts, as)] },
            ],
          },
        ],
      },
      ...newType(opts, { labelled: true }),
    ],
  };
}

/**
 * The button that defines a new reaction type, and the form behind it.
 *
 * Offered where somebody arrives having looked for the reaction they wanted and not found it — a
 * full row in an inspector, or the sheet, which is that row with room. That is the moment a
 * vocabulary is felt to be short, so it is where the answer belongs; Settings → Vocabulary is the
 * other way to the same form and it is the wrong one here, since it means leaving the thing you
 * were reacting to in order to describe how you wanted to react to it.
 *
 * The same form as that section's, through `createSignalTypeModal`, rather than a smaller one
 * written for this surface. A second form would be a second idea of what a reaction type is, and
 * the modes carry range, step and a secondary icon that a "quick add" would quietly drop — which is
 * how a community ends up with a rating that is secretly a toggle.
 *
 * Gated as that section gates it: defining a reaction names something every member will then see,
 * so it is an administrator's act wherever it is done from. A member without the right sees the
 * reactions and no plus, which is exactly what they see in Settings.
 *
 * `labelled` is the whole difference between the two surfaces that carry it: a row of controls in a
 * panel has room for a plus and a tooltip, and the sheet — where somebody is reading a list of what
 * each reaction means — has room for the words and needs them, since a lone plus under a list reads
 * as "add a row" rather than "name a kind of reaction".
 *
 * Empty for a read-only display, which is drawing rather than offering.
 */
function newType(opts: Resolved, { labelled }: { labelled: boolean }): SchemaNode[] {
  if (opts.readOnly) return [];
  const button: SchemaNode = {
    type: 'we-button',
    props: {
      variant: labelled ? 'secondary' : 'bare',
      size: opts.size === 'xs' && !labelled ? 'xs' : 'sm',
      ...(labelled ? {} : { color: 'text-faint', hoverProps: { color: 'text' } }),
      label: 'New reaction type',
      onClick: { $setLocal: NEW_TYPE_OPEN, value: true },
    },
    children: [
      { type: 'we-icon', props: { name: 'plus' } },
      ...(labelled ? [{ type: 'we-text', children: ['New reaction type'] } as SchemaNode] : []),
    ],
  };
  return [
    {
      type: '$if',
      props: {
        condition: { $: 'spaceStore.canAdministerCurrentSpace' },
        then: {
          type: labelled ? 'Row' : 'we-tooltip',
          ...(labelled ? { props: { width: '100%' } } : { props: { content: 'New reaction type' } }),
          children: [
            button,
            createSignalTypeModal({
              open: { $: `local.${NEW_TYPE_OPEN}` },
              close: { $setLocal: NEW_TYPE_OPEN, value: false },
            }),
          ],
        },
      },
    },
  ];
}

/** A row of marks, and a way to the rest. */
function compactRow(opts: Resolved, as: string): SchemaNode {
  const limit = opts.max ?? 4;
  /** Marks the `max` dropped — a number worth showing, because those reactions are really there. */
  const overflow = `count(${typesShown(opts)}) - ${limit}`;
  /** Anything the community offers that this row is not drawing: unused types, and the overflow. */
  const offstage = `count(${OFFERED_SIGNAL_TYPES}) - count(${typesShown(opts, limit)})`;
  return {
    type: 'Row',
    props: { gap: opts.size === 'md' ? '500' : '300', ay: 'center', wrap: true },
    children: [
      {
        type: '$each',
        props: { items: { $: typesShown(opts, limit) }, as },
        children: [mark(opts, as)],
      },
      /*
        The way to everything this row is not showing — and the reason `compact` is allowed to hide
        anything at all.

        This used to appear only when `max` had dropped a mark, which meant a surface needed FIVE
        types already in use before it offered a way in. On a comment with one reaction, or none,
        the row rendered nothing at all: a mode whose whole premise is "the rest are reached through
        the modal" had no door to the modal, so a reader could press the reactions that happened to
        be there and could not give a different one. `showUnused: false` was hiding a vocabulary
        with nothing to open it.

        So the door is present whenever anything is offstage — a type nobody has used here yet, or a
        mark `max` dropped — and it is the same door either way, since "give a different reaction"
        and "see the other reactions" land in the same sheet.

        The plus is what it always says; the number appears only when there is an honest one to
        show. Marks dropped by `max` are reactions people really gave, so `+3` counts those; unused
        types are not a count of anything, so they add nothing to it and a bare plus reads as
        "react with something else" rather than claiming three more people are in there.

        Not under `readOnly`: a card that is dragged rather than operated has no business opening a
        sheet, and the marks beside this are already inert.
      */
      ...(opts.readOnly
        ? []
        : [
            {
              type: '$if',
              props: {
                condition: { $: `${offstage} > 0` },
                then: {
                  type: 'we-button',
                  props: {
                    variant: 'bare',
                    size: opts.size === 'md' ? 'sm' : 'xs',
                    color: 'text-faint',
                    hoverProps: { color: 'text' },
                    label: 'React with something else',
                    onClick: { $setLocal: MODAL_OPEN, value: true },
                  },
                  children: [
                    { type: 'we-icon', props: { name: 'plus' } },
                    {
                      type: '$if',
                      props: {
                        condition: { $: `${overflow} > 0` },
                        then: { type: 'we-text', children: [{ $: overflow }] },
                      },
                    },
                  ],
                },
              },
            } as SchemaNode,
          ]),
    ],
  };
}

/**
 * One mark for the whole vocabulary, and how many people have reacted at all.
 *
 * Records, never values: "twelve" summing seven likes, three stars and two downvotes is not a
 * number, and "twelve people reacted" is — the only honest thing one mark standing for a whole
 * vocabulary can say. `signalTally` holds that rule; see its own note for why retired types still
 * count toward it.
 *
 * The glyph is deliberately not any type's. Borrowing one would claim the number was that type's,
 * and on a space whose first reaction is a heart the total would read as a like count.
 */
function totalMark(opts: Resolved): SchemaNode {
  return {
    type: 'CountMark',
    props: {
      icon: 'smiley',
      count: { $: `signalTally({ signals: ${everything(opts.record)} })` },
      mine: { $: `count(filter(${opts.record}.signals, { author: me.did }))` },
      ...(opts.size && { size: opts.size }),
      label: 'Reactions',
      ...(opts.readOnly ? {} : { onPress: { $setLocal: MODAL_OPEN, value: true } }),
    },
  };
}

/**
 * The whole vocabulary in a sheet — `full`, with room.
 *
 * Mounted only while open, so the controls inside are built fresh each time and a modal closed on
 * one record cannot reopen holding another's. `signalsModalOpen` is declared on this fragment's own
 * root, which inside an `$each` means one per row.
 */
function modal(opts: Resolved, as: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `local.${MODAL_OPEN}` },
      then: {
        type: 'we-modal',
        props: { size: 'sm', close: { $setLocal: MODAL_OPEN, value: false } },
        children: [
          // `slot` is a node-level key, not a prop — see `peopleTooltip`, which says the same thing
          // one overlay along. Pinned in `props` it is an unknown prop on `we-text` and the heading
          // lands in the modal's scrolling body instead of its header.
          { type: 'we-text', slot: 'header', props: { variant: 'heading-md' }, children: ['Reactions'] },
          /*
            The same list a panel draws, which is what `fullRow` answers with when it owns the line.

            It briefly had a copy of that layout here, written when `full` was still a wrapping row
            and the sheet needed something better. Then the panel wanted the better one too — so the
            layout moved into `fullRow` and this went back to one call. Two spellings of "one type
            per row with its name beside it" is two chances to drift, which is the whole reason this
            fragment exists.

            `inline: false` is what asks for it, and `showUnused` is forced: the sheet is where the
            rest are reached from, so arriving to find it showing the same subset as the row behind
            it would be a door onto the room you were already in.
          */
          fullRow({ ...opts, mode: 'full', showUnused: opts.showUnused ?? true, inline: false }, as),
        ],
      },
    },
  };
}

/**
 * The reactions on one record, at the density the surface asked for.
 *
 * Renders `empty`, or nothing, where the community has defined no types. Nothing is seeded on its
 * behalf *here* — a space is given a `like` when it is created, which is where a default belongs,
 * and a space that has since retired everything should not have one conjured back by a renderer.
 */
export function signalDisplay(options: SignalDisplayOptions): SchemaNode {
  const as = options.as ?? 'sig';
  const mode = options.mode ?? 'full';
  const opts: Resolved = { ...options, mode, as };
  const body = mode === 'full' ? fullRow(opts, as) : mode === 'compact' ? compactRow(opts, as) : totalMark(opts);

  return {
    type: '$if',
    props: {
      condition: { $: HAS_OFFERED_SIGNAL_TYPES },
      ...(opts.empty && { else: opts.empty }),
      then: {
        type: 'Column',
        props: { ...(opts.inline ? {} : { width: '100%' }) },
        // Per display: inside an `$each` this is created per row, so two records cannot disagree
        // about whose reactions are open.
        $localState: {
          ...(mode === 'full' ? {} : { [MODAL_OPEN]: { type: 'boolean', initial: false } }),
          // Declared in every mode: `fullRow` carries the button that sets it, and `fullRow` is
          // both what `full` renders and what the sheet holds.
          [NEW_TYPE_OPEN]: { type: 'boolean', initial: false },
        },
        /*
          The sheet is built only where something can open it. A read-only display has no door —
          no plus on a compact row, no press on a total's mark — so a modal beside one is a subtree
          of live controls that nothing can reach.
        */
        children: mode === 'full' || opts.readOnly ? [body] : [body, modal(opts, as)],
      },
    },
  };
}
