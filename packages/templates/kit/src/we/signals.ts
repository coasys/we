/**
 * Reacting to a record, and saying at a glance that others have.
 *
 * Two fragments for two surfaces, and the split is the whole design. {@link signalsSection} is the
 * place a reaction is *given* — every type the community offers, including the ones nobody has used
 * yet, because otherwise the first reaction in a space can never be given. {@link activitySummary}
 * is the place a reaction is *seen* — counts only, no controls, small enough to sit in the meta row
 * of a card among a due date and a face.
 *
 * Before these existed there was one spelling of this, `signalRow` in the showcase package, written
 * for a feed row: controls, but only for types somebody had already used. That rule is right for a
 * feed (see its own note) and wrong for every detail surface, which is why `EdgeDetail` had a hand-
 * written copy showing all of them and the workshop's inspector had none at all — the panel that
 * opens a card out and shows every field it holds could not say whether anybody liked it.
 *
 * ## Ambient scope — what these read from the tree
 *
 * Both need two things an ancestor provides, and neither can declare for itself:
 *
 * - **`local.signalTypes`** — a hoisted `{ entity: 'SignalType', subscribe: true }`, declared on the
 *   node that renders the list rather than per row. One subscription for a panel, not one per card.
 *   **Declare it inside the route or panel that uses it**, never only on a template root: a route
 *   subtree is rendered through a fresh `RenderSchema` call and inherits no context from above the
 *   `$routes` outlet, so a declaration up there resolves to nothing, the count guard reads falsy and
 *   the controls simply never appear.
 * - **`<record>.signals`, hydrated** — `include: { signals: true }` on the query that fetched the
 *   record. Without it the relation arrives as ids, `filter(…, { signalTypeId })` matches nothing,
 *   and every count reads zero while the reactions are plainly there.
 *
 * `activitySummary`'s reply count needs neither: `comments` is read as the relation's own ids, which
 * arrive whether or not anything was included — see `replyCount`, which does the same.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { HAS_OFFERED_SIGNAL_TYPES, OFFERED_SIGNAL_TYPES } from './signalTypes.ts';

export interface SignalsSectionOptions {
  /** Context key of the record being reacted to — `'row'`, `'link'`, `'card'`. */
  record: string;
  /** Context key bound per signal type. Defaults to `'sig'`; change it inside another `$each` using that name. */
  as?: string;
}

/**
 * Every reaction this community offers, for one record — the surface a reaction is given on.
 *
 * All of them, whether or not anybody has used them, which is the difference from a feed row and the
 * reason this exists: a type a community defined and nobody has used yet is exactly the one that
 * needs a control, and hiding it leaves a space whose vocabulary is unreachable from every surface
 * at once. A detail panel has the room a feed row does not.
 *
 * Renders nothing where the community has defined no types, which is correct rather than a gap: a
 * space that has not said what reacting means here should not be offered a heart on its behalf.
 * Retired types are left out through {@link OFFERED_SIGNAL_TYPES} — withdrawn from use, while the
 * counts they already carry go on resolving, which is what retiring means.
 */
export function signalsSection(opts: SignalsSectionOptions): SchemaNode {
  const as = opts.as ?? 'sig';
  return {
    type: '$if',
    props: {
      condition: { $: HAS_OFFERED_SIGNAL_TYPES },
      then: {
        /*
          Wrapping, and a floor under its height.

          A community may offer five types and a panel is 320px wide, so the row wraps rather than
          pushing the panel's own scroll sideways. The floor is what stops the section appearing a
          frame late and shoving everything below it down: the controls are buttons, which have a
          height the moment they exist and none before the subscription answers.
        */
        type: 'Row',
        props: { gap: '400', ay: 'center', wrap: true, width: '100%', minHeight: '40px' },
        children: [
          {
            type: '$each',
            props: { items: { $: OFFERED_SIGNAL_TYPES }, as },
            children: [
              {
                type: 'SignalControl',
                props: {
                  signalType: { $: as },
                  signals: { $: `filter(${opts.record}.signals, { signalTypeId: ${as}.id })` },
                  myDid: { $: 'me.did' },
                  onSignal: {
                    $action: 'spaceStore.upsertSignal',
                    args: [{ $: `${opts.record}.id` }, { $: `${as}.id` }, { $: 'arg' }],
                  },
                },
              },
            ],
          },
        ],
      },
    },
  };
}

export interface ActivitySummaryOptions {
  /** Context key of the record. */
  record: string;
  /** Include the reply count. Defaults to true; pass `false` on a surface that shows the thread itself. */
  replies?: boolean;
  /** Context key bound per signal type. Defaults to `'sum'` — `'sig'` is what the controls use. */
  as?: string;
  /** What pressing the summary does — usually selecting the card, so the thread opens where it lives. */
  onClick?: SchemaProp;
}

/**
 * What this record has collected, as a line of counts — for a card, where there is no room for more.
 *
 * A canvas card is clipped and a board card is dense and draggable, so neither can carry a row of
 * buttons: a control per type on every card is furniture competing with the gesture the card is
 * there for. What a card owes the reader is the fact that a conversation is happening on it, and a
 * way in — so this draws the glyph and the number for each type somebody has used, the reply count
 * beside them, and nothing at all for a record nobody has touched.
 *
 * Silent when there is nothing to say, deliberately: a column of "0"s down a board asserts nothing
 * and costs a line on every card. The same rule `replyCount` follows, for the same reason.
 *
 * One count per type rather than the type's own aggregate — a mean rating reads as a *judgement* and
 * wants the control's own drawing, where this is answering "has anybody been here". The rating
 * itself is one press away, in whatever surface this card opens.
 */
export function activitySummary(opts: ActivitySummaryOptions): SchemaNode {
  const as = opts.as ?? 'sum';
  const given = `filter(${opts.record}.signals, { signalTypeId: ${as}.id })`;
  const replies = opts.replies !== false;
  return {
    type: 'Row',
    props: {
      gap: '300',
      ay: 'center',
      ...(opts.onClick ? { onClick: opts.onClick, cursor: 'pointer' } : {}),
    },
    children: [
      {
        type: '$each',
        props: { items: { $: OFFERED_SIGNAL_TYPES }, as },
        children: [
          {
            type: '$if',
            props: {
              condition: { $: `count(${given})` },
              then: {
                type: 'Row',
                props: { gap: '100', ay: 'center' },
                children: [
                  { type: 'we-icon', props: { name: { $: `${as}.icon` }, size: 'xs', color: 'text-faint' } },
                  {
                    type: 'we-number',
                    props: { value: { $: `count(${given})` }, shorten: true, fontSize: '100', color: 'text-muted' },
                  },
                ],
              },
            },
          },
        ],
      },
      ...(replies
        ? [
            {
              type: '$if',
              props: {
                condition: { $: `count(${opts.record}.comments)` },
                then: {
                  type: 'Row',
                  props: { gap: '100', ay: 'center' },
                  children: [
                    { type: 'we-icon', props: { name: 'chat-circle', size: 'xs', color: 'text-faint' } },
                    {
                      type: 'we-number',
                      props: {
                        value: { $: `count(${opts.record}.comments)` },
                        shorten: true,
                        fontSize: '100',
                        color: 'text-muted',
                      },
                    },
                  ],
                },
              },
            } as SchemaNode,
          ]
        : []),
    ],
  };
}
