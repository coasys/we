import type { SchemaNode } from '@we/schema-shared';

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
   * is why `total` and `compact` both lead there.
   */
  showUnused?: boolean;
  /**
   * Draw only. For a card that is dragged rather than operated: a row of live controls on something
   * whose gesture is "pick me up" is furniture competing with the thing the card is for.
   */
  readOnly?: boolean;
  /**
   * Marks before the rest become a `+N` into the modal, in `compact`. Defaults to 4.
   *
   * This rather than switching mode on type count: an author picked `compact` because of the room
   * the surface has, and that does not stop being true when a community names a fifth reaction.
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

/** One type's signals here, less the ones from agents this reader has muted. */
const forType = (record: string, as: string) =>
  `filter(${record}.signals, { signalTypeId: ${as}.id, author: { not: spaceStore.mutedDids } })`;

/** Everything on the record, less muted authors — what the single total counts. */
const everything = (record: string) => `filter(${record}.signals, { author: { not: spaceStore.mutedDids } })`;

/** Whether this agent has reacted with this type. What makes a mark read as "mine". */
const mineOfType = (record: string, as: string) =>
  `count(filter(${record}.signals, { signalTypeId: ${as}.id, author: me.did }))`;

/**
 * The types this display draws, which is the whole of what `showUnused` decides.
 *
 * `filter(…, {}, max)` keeps the first N — the same limit the overflow counts against, so the two
 * cannot disagree about which marks are shown.
 */
function typesShown(opts: SignalDisplayOptions, as: string, limit?: number): string {
  const used = `${OFFERED_SIGNAL_TYPES}.filter(t, count(filter(${opts.record}.signals, { signalTypeId: t.id, author: { not: spaceStore.mutedDids } })))`;
  const all = (opts.showUnused ?? opts.mode === 'full') ? OFFERED_SIGNAL_TYPES : used;
  void as;
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
function control(opts: SignalDisplayOptions, as: string): SchemaNode {
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
function mark(opts: SignalDisplayOptions, as: string): SchemaNode {
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
 */
function fullRow(opts: SignalDisplayOptions, as: string): SchemaNode {
  return {
    /*
      Wrapping, and a floor under its height.

      A community may offer five types and a panel is 320px wide, so the row wraps rather than
      pushing the panel's own scroll sideways. The floor is what stops the section appearing a frame
      late and shoving everything below it down: the controls are buttons, which have a height the
      moment they exist and none before the subscription answers.
    */
    type: 'Row',
    props: {
      gap: opts.size === 'xs' ? '300' : '400',
      ay: 'center',
      wrap: true,
      ...(opts.inline ? {} : { width: '100%', minHeight: '40px' }),
    },
    children: [
      {
        type: '$each',
        props: { items: { $: typesShown(opts, as) }, as },
        children: [meaning(as, [control(opts, as)])],
      },
    ],
  };
}

/** A row of marks, and a way to the rest. */
function compactRow(opts: SignalDisplayOptions, as: string): SchemaNode {
  const limit = opts.max ?? 4;
  const hidden = `count(${typesShown(opts, as)}) - ${limit}`;
  return {
    type: 'Row',
    props: { gap: opts.size === 'md' ? '500' : '300', ay: 'center', wrap: true },
    children: [
      {
        type: '$each',
        props: { items: { $: typesShown(opts, as, limit) }, as },
        children: [mark(opts, as)],
      },
      /*
        The rest, as a door rather than as a wrap.

        A sixth mark does not make a card unreadable on its own — a row of nine does, and a surface
        that chose `compact` chose it for the room it has. `+N` keeps the shape the author picked
        and puts the remainder exactly where every other "there is more" in this fragment puts it.
      */
      {
        type: '$if',
        props: {
          condition: { $: `${hidden} > 0` },
          then: {
            type: 'we-button',
            props: {
              variant: 'bare',
              size: opts.size === 'md' ? 'sm' : 'xs',
              color: 'text-faint',
              hoverProps: { color: 'text' },
              label: 'Show every reaction',
              onClick: { $setLocal: MODAL_OPEN, value: true },
            },
            children: [{ $: `'+' + ${hidden}` }],
          },
        },
      },
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
function totalMark(opts: SignalDisplayOptions): SchemaNode {
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
function modal(opts: SignalDisplayOptions, as: string): SchemaNode {
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
export function signalDisplay(opts: SignalDisplayOptions): SchemaNode {
  const as = opts.as ?? 'sig';
  const mode = opts.mode ?? 'full';
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
        ...(mode === 'full' ? {} : { $localState: { [MODAL_OPEN]: { type: 'boolean', initial: false } } }),
        children: mode === 'full' ? [body] : [body, modal(opts, as)],
      },
    },
  };
}
