/**
 * A kanban board whose columns are records, and whose membership is still a query.
 *
 * ## The one decision everything follows from
 *
 * **State is a fact about the work; position is a fact about the pair.** A task's `status` is read
 * by every surface in WE; where it sits on *this* board is nobody else's business. So a column is
 * two things at once, and the split is deliberate:
 *
 * - **What is in it** comes from the task's `status` matching the column's `slug`. A query, so work
 *   arrives on its own — an extraction pass writes three tasks and no board writes at all, and they
 *   appear on every board that has a column for that state, including one made tomorrow.
 * - **Where each card sits** is the column's ordered `arranges`. Position hints over a membership
 *   defined elsewhere, which is the same relationship AD4M's ordering entries have to the links they
 *   order, one level up.
 *
 * A column is therefore *a saved query with an arrangement*, which is the sentence to keep in mind
 * when this looks like a hybrid. Pure containment — a card is in To-do because To-do holds a link to
 * it — is the obvious alternative and it is the one that breaks: membership then has to be
 * maintained per board forever, a board made tomorrow is empty until somebody backfills it, and its
 * failure mode is a task that is *invisible* rather than one that is visibly misfiled.
 *
 * ## Where the working out happens
 *
 * Not here. Which cards a column shows, in what order, what is left over and what the heading says
 * are one call to `arrangedBoard`, a function the host registers — see its docblock for the rules
 * and for why they moved out of the expression layer. This fragment is arrangement: three
 * subscriptions in, an `$each` over the columns it answers with, a card per row.
 *
 * ## Two kinds of column
 *
 * | | Bound (`slug` set) | Local lane (`slug` empty) |
 * |---|---|---|
 * | Membership | the query above, plus its arrangement | arrangement only |
 * | Dropping a card | writes `status` — every board follows | writes one link — this board only |
 * | New matching work | arrives on its own | never arrives on its own |
 *
 * A lane is how somebody organises without imposing: "Thursday", "Waiting on Ana". Never filling
 * itself is the price of claiming no shared meaning, and it is the right price. A lane that turns
 * out to matter is promoted by naming it in Settings → Vocabulary, which makes it a slug.
 *
 * ## Any record, not only tasks
 *
 * `entity` and `card` let a board arrange something other than `TaskBlock`. A board of records with
 * no state field is a board of lanes, which is the containment kanban — the showcase's Boards
 * template is one, over composed posts. The same fragment, because a lane-only board *is* the
 * special case where nothing binds; see `lanesOnly`.
 */
import { field, formModal, sectionLabel } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { peopleFilter } from './peopleFilter.ts';
import { signalDisplay } from './signalDisplay.ts';
import {
  answerButton,
  suggestedChanges,
  suggestionsToggle,
  UNCONFIRMED,
  withoutHiddenSuggestions,
} from './suggestions.ts';

/** The board record, hydrated one level: its columns, its own arrangement, what it gathers. */
const BOARD = 'first(local.board)';

/**
 * The board, worked out — the one call the whole fragment reads from.
 *
 * `local.board` supplies the column order, `local.columns` their contents, `local.pool` everything
 * in scope, and the community's states supply names and shapes for headings. One string, reused, so
 * every reader agrees on the answer; each use is its own memo, and the function is cheap.
 */
/*
  `records` less what nobody has kept, while the reader has hidden it — see `suggestions.ts`. Filtered
  before the board is worked out rather than after, so every count, the Unplaced column and the people
  filter agree about what is on the board.
*/
const VIEW = `arrangedBoard({ board: first(local.board), columns: local.columns, records: ${withoutHiddenSuggestions('local.pool')}, states: spaceStore.taskStates, involvements: local.involvements, kinds: spaceStore.involvementTypes, people: local.boardPeople, show: local.boardGrouped ? 'rows' : (local.boardShow == 'hide' ? 'hide' : 'dim'), me: me.did })`;

/**
 * Who is on each card — the `involvement` host function over the board's own involvement query.
 *
 * Read by the card for its faces and its assign menu. The board's filtering reads the same rows
 * through `arrangedBoard`, so a card is never dimmed for somebody its faces say is on it.
 */
const PEOPLE = 'involvement({ rows: local.involvements, types: spaceStore.involvementTypes, me: me.did })';

/** What the card in scope carries of it: `{ people, responsible, reviewing, pairs, … }`, or nothing. */
const ON = (as: string) => `${PEOPLE}.byNode[${as}.id]`;

/** What the column in scope shows and how its heading reads — see `ColumnContents`. */
const CELL = `${VIEW}.contents[col.id]`;

/**
 * The container a gathering board draws from, as a record id — or nothing.
 *
 * `gathers` names either the Space record or a container's. The space's own board narrows to
 * nothing, since its scope *is* the space; a container's board narrows to that container; a board
 * that gathers nothing has no anchor, and its pool is the whole space so the add-card picker can
 * bring anything in. An empty anchor is what the renderer reads as "do not narrow".
 */
const ANCHOR = `(${BOARD}.gathers && ${BOARD}.gathers != spaceStore.currentSpace.id) ? ${BOARD}.gathers : ''`;

export interface TaskCardOptions {
  /** Controls shown at the end of the card's meta row — usually {@link moveTaskMenu}. */
  actions?: SchemaNode;
  /** Context key the card reads. Defaults to `'card'`, which is what {@link taskBoard} binds. */
  as?: string;
  /**
   * When to show the card's state on it — an expression, evaluated per row. Omit for never.
   *
   * A bound column *is* the state, so a badge there would repeat the column's own heading on every
   * card. The two places it is worth showing are the ones where the column says nothing about it: a
   * **lane**, which claims no state and deliberately leaves a card's alone, and the **unplaced**
   * column, whose whole meaning is "no column here names this card's state". Those are exactly the
   * cards whose state is otherwise invisible.
   */
  showState?: string;
  /**
   * Whether a model proposed this card from a conversation rather than somebody writing it — an
   * expression, per row. Omit where nothing on the board is extracted.
   *
   * Not the author, which is what this used to show, as a name in the card's own heading type. On an
   * extracted task the author is whichever member's node happened to run the pass — not who proposed
   * the work — so a name there claimed something false, and was the most prominent person on the card
   * besides. A small mark says what is true; who ran the pass is in the people hovercard, with the
   * rest of where the card came from.
   */
  extracted?: string;
  /**
   * Mark a card extraction **made** and nobody has kept — an expression, per row.
   *
   * A staged record is in the graph, so it answers the board's query exactly as an accepted one does;
   * without this a suggestion was indistinguishable from a decision. Drawn provisional — dashed,
   * faded, "suggested" — with Keep and Discard. Only for records a pass created: an agreed record with
   * a change suggested is not in doubt and is drawn with `suggestions` instead. See {@link UNCONFIRMED}.
   */
  pending?: string;
  /**
   * Show the changes a pass suggested to this card, if it is an agreed record carrying any — as
   * old → new lines, each applied or dismissed alone. See `suggestedChanges`.
   */
  suggestions?: boolean;
  /**
   * The card's fill, as an expression evaluated per row. Defaults to `surface`.
   *
   * For a board that colours its cards by some rule of its own — the workshop's key colours a task
   * by its state or by its kind, and a card the reader has coloured on the canvas keeps that colour
   * here. A colour is the one thing about a card's look a caller can sensibly have an opinion on
   * without redrawing the card, so it is an option rather than a reason to supply `card`. The
   * expression should answer `'surface'` where the rule has nothing to say.
   */
  bg?: SchemaProp;
  /** Draw the card faded — an expression, per row. For a people filter in `dim`; see `arrangedBoard`. */
  dimmed?: string;
  /**
   * Who is on the card, and a menu to change it.
   *
   * The entity whose kinds the menu offers — `TaskBlock` on a task board. Omit for a card with no
   * people on it. Needs the board's involvement query in scope, which `taskBoard` declares.
   */
  peopleOf?: string;
  /**
   * Pressing the card selects it — see {@link TaskBoardOptions.select}. Omit for a card that is not
   * selectable.
   */
  select?: CardSelection;
  /**
   * Show what the card has collected — reactions by type, and the reply count. Off by default.
   *
   * Counts, never controls. A board card is dense and draggable, so a row of buttons on each would
   * compete with the gesture the card exists for; what a card owes the reader is that a conversation
   * is happening on it, and selecting the card opens that conversation in the inspector. Silent for
   * a card nobody has touched, so a quiet board gains no furniture at all.
   *
   * Needs hydrated `signals` on the row and `local.signalTypes` above it. {@link taskBoard} declares
   * both when its own `social` is set — this option is for a caller drawing its own cards.
   */
  social?: boolean;
}

/** How a card is selected: which card is, and what pressing one does. */
export interface CardSelection {
  /** An expression for the id of the selected card, or empty — `routeStore.params.card`. */
  selected: string;
  /**
   * What pressing a card does, with the card in scope under its context key. Usually writes where
   * `selected` reads, and clears it when the card pressed is the one already selected.
   */
  onSelect: SchemaProp;
}

/**
 * Every record with anything staged on it, of either kind — the transcribe module's list, by id.
 *
 * A module namespace resolves to nothing where the module is not installed, and a map over nothing
 * is an empty list, so a board on a deployment without extraction marks nothing and asks nothing.
 *
 * Both kinds together, which is almost never the question: a card is provisional only if a pass
 * *made* it ({@link UNCONFIRMED}), and an agreed card with a change suggested ({@link CHANGED}) is not.
 * Kept for a surface that genuinely asks "is anything waiting on this record".
 */
// The transcribe module's list, so a template placing a board with suggestion controls depends on
// that module and should declare it: `meta.requires.modules: ['transcribe']`. See `suggestions.ts`.
export const PENDING = 'modules.transcribe.pendingIds';

/** Whether the card in scope is the selected one, as expression source — `false` where nothing selects. */
const selectedExpr = (opts: TaskCardOptions, as: string) =>
  opts.select ? `(${as}.id == ${opts.select.selected})` : 'false';

/**
 * One task, as a card.
 *
 * Shows what triage needs and no more; the rest belongs on the task's own page. `priority` shows
 * only when it is not the default, or a board is a wall of "medium".
 */
export function taskCard(opts: TaskCardOptions = {}): SchemaNode {
  const as = opts.as ?? 'card';
  const pending = opts.pending ?? 'false';
  return {
    type: 'Column',
    props: {
      width: '100%',
      gap: '200',
      bg: opts.bg ?? 'surface',
      r: '300',
      p: '300',
      /*
        A suggestion looks like one: dimmed, with a dashed edge, the way the canvas draws it. A
        selected card takes the accent — what selected means everywhere else, and in the people filter
        beside it — as its border and a one-pixel ring outside it, which together read as two pixels
        without the border growing and nudging the column.
      */
      border: {
        $: `${selectedExpr(opts, as)} ? '1px solid accent' : (${pending}) ? '1px dashed border-strong' : '1px solid border'`,
      },
      ring: { $: `${selectedExpr(opts, as)} ? '0 0 0 1px var(--we-role-accent)' : ''` },
      ...(opts.select ? { cursor: 'pointer', onClick: opts.select.onSelect } : {}),
      /*
        Faded further for a card the people filter does not match. Well below a suggestion's 0.75, so
        the two never read as one state; above zero, so the board's shape is still legible through it,
        which is the whole reason dimming is the default.
      */
      opacity: { $: `(${opts.dimmed ?? 'false'}) ? 0.35 : (${pending}) ? 0.75 : 1` },
      transition: 'opacity 200 ease-in-out',
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'start', ax: 'between', width: '100%' },
        children: [
          // The title gives up room; the badge never does — a badge squeezed onto three lines reads
          // as three words.
          {
            type: 'we-text',
            props: { fontWeight: 'semibold', flex: '1 1 auto', minWidth: '0' },
            children: [{ $: `${as}.title` }],
          },
          {
            type: '$if',
            props: {
              condition: { $: pending },
              then: {
                type: 'we-tooltip',
                props: { content: 'Extraction proposed this — pending acceptance' },
                children: [
                  {
                    type: 'we-badge',
                    props: {
                      size: 'xs',
                      variant: 'warning',
                      // Solid, as the recording badges are: a soft warning reads as decoration, and
                      // this is the one thing on the card that asks for a decision.
                      appearance: 'solid',
                    },
                    children: ['suggested'],
                  },
                ],
              },
            },
          },
        ],
      },
      {
        type: '$if',
        props: {
          condition: { $: `${as}.description` },
          then: {
            type: 'we-text',
            props: { fontSize: '200', color: 'text-muted', truncate: true },
            children: [{ $: `${as}.description` }],
          },
        },
      },
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          {
            type: '$if',
            props: {
              condition: { $: `${as}.priority != 'medium'` },
              then: {
                type: 'we-badge',
                props: { size: 'xs', variant: { $: `${as}.priority == 'high' ? 'danger' : 'neutral'` } },
                children: [{ $: `${as}.priority` }],
              },
            },
          },
          {
            type: '$if',
            props: {
              condition: { $: `${as}.dueDate` },
              then: {
                type: 'we-text',
                props: { fontSize: '200', color: 'text-muted' },
                children: [{ $: `${as}.dueDate` }],
              },
            },
          },
          // Without people, the name a conversation said is still the words that were said.
          ...(opts.peopleOf
            ? []
            : [
                {
                  type: '$if',
                  props: {
                    condition: { $: `${as}.assignee` },
                    then: {
                      type: 'we-text',
                      props: { fontSize: '200', color: 'text-muted' },
                      children: [{ $: '`@${' + as + '.assignee}`' }],
                    },
                  },
                } as SchemaNode,
              ]),
          ...(opts.extracted
            ? [
                {
                  type: '$if',
                  props: {
                    condition: { $: opts.extracted },
                    /*
                      Where the card came from, on the mark that makes a reader ask.

                      It used to be the last line of the people hovercard, which is about who is on the
                      work — a different question. The sparkle is what says this card is unusual, so it
                      is where the answer is: extracted from the conversation, on whose node, and when.
                      A card somebody added by hand has nothing unusual to explain, and says nothing.
                    */
                    then: {
                      type: 'we-tooltip',
                      props: { placement: 'top' },
                      children: [
                        {
                          // A native element carries the slot — see `peopleTooltip` for why a Column cannot.
                          type: 'div',
                          slot: 'content',
                          children: [
                            {
                              type: '$agent',
                              props: { did: { $: `${as}.author` }, as: 'author' },
                              children: [
                                {
                                  type: 'Row',
                                  props: { gap: '100', ay: 'center', wrap: true },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: {
                                        fontSize: '200',
                                        text: {
                                          $: "`Extracted from the conversation · run by ${author.did == me.did ? 'you' : author.name}`",
                                        },
                                      },
                                    },
                                    {
                                      type: 'we-timestamp',
                                      props: { value: { $: `${as}.createdAt` }, relative: true, fontSize: '200' },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                        { type: 'we-icon', props: { name: 'sparkle', size: 'xs', color: 'text-muted' } },
                      ],
                    },
                  },
                } as SchemaNode,
              ]
            : []),
          // The card's state, where the caller says the column does not already give it away.
          {
            type: '$if',
            props: {
              condition: { $: `(${opts.showState ?? 'false'}) && ${as}.status` },
              then: {
                type: 'we-tooltip',
                props: { content: 'The state this work is in — a lane does not change it' },
                children: [
                  {
                    type: 'we-badge',
                    props: { size: 'xs', variant: 'neutral' },
                    children: [
                      {
                        $: `find(spaceStore.taskStates, { slug: ${as}.status }).name ?? ${as}.status`,
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            type: 'Row',
            // `300` between the controls and the faces: at `100` a stack and a button read as touching.
            props: { ml: 'auto', gap: '300', ay: 'center' },
            children: [
              // First in the group, so the counts sit left of anything that can be pressed — they are
              // the one thing here that is a reading rather than a control.
              /*
                What people have made of this card, as a reading rather than a control.

                `compact` and `readOnly`: a board card is dragged, so a row of live controls on it is
                furniture competing with the gesture the card exists for — and the counts are the
                part somebody scanning a column actually wants. Used types only, which is what
                `compact` does by default; the card's own page has them all.

                The reply count that used to sit beside these went with `activitySummary`. It is a
                count of comments rather than of reactions, and a fragment named for signals has no
                business carrying one — the card draws it itself, with the same mark the feed uses.
              */
              ...(opts.social
                ? [
                    signalDisplay({
                      record: as,
                      as: `${as}Sum`,
                      mode: 'compact',
                      size: 'xs',
                      readOnly: true,
                      inline: true,
                    }),
                    {
                      type: '$if',
                      props: {
                        condition: { $: `count(${as}.comments)` },
                        then: {
                          type: 'CountMark',
                          props: {
                            icon: 'chat-circle',
                            count: { $: `count(${as}.comments)` },
                            size: 'xs',
                            label: 'Comments',
                          },
                        },
                      },
                    } as SchemaNode,
                  ]
                : []),
              /*
                Keep and Discard, on the card, where the work is — the same two the canvas offers and
                the same actions behind them. Neither asks first: keeping writes what was proposed,
                discarding removes something nobody agreed to, and a dialog in front of either is a
                question about a question. Deleting an accepted card stays where it was, on the
                card's own page, behind the host's confirmation.
              */
              {
                type: '$if',
                props: {
                  condition: { $: pending },
                  then: {
                    type: 'Row',
                    props: { gap: '100', ay: 'center' },
                    // Drawn as the canvas draws them: a raised circle, the glyph in the success or
                    // danger role, filling with that role's surface under the pointer. The theme's
                    // accent says "primary action"; a tick that means "yes, this" is green everywhere
                    // else in the app.
                    children: [
                      answerButton({
                        tone: 'success',
                        label: 'Accept',
                        onClick: { $action: 'modules.transcribe.acceptProposal', args: [{ $: `${as}.id` }] },
                      }),
                      answerButton({
                        tone: 'danger',
                        label: 'Reject — removes it',
                        onClick: { $action: 'modules.transcribe.rejectProposal', args: [{ $: `${as}.id` }] },
                      }),
                    ],
                  },
                },
              },
              ...(opts.actions ? [opts.actions] : []),
              // Last, at the card's right edge — where every board puts whoever is on the work.
              ...(opts.peopleOf ? [cardPeople(as, opts.peopleOf, opts.bg ? undefined : 'var(--we-role-surface)')] : []),
            ],
          },
        ],
      },
      /*
        Last, under a rule: what a pass suggests changing about this agreed card. The card above it is
        drawn exactly as it is, since nothing about the record is in doubt — only the change is.
      */
      ...(opts.suggestions ? [suggestedChanges({ record: as })] : []),
    ],
  };
}

/**
 * The faces on a card, which are also how to change them.
 *
 * ## The one person-shaped thing on a card is whoever is on the work
 *
 * Every board that has settled this puts the assignee at the right end of the card and nobody else
 * on its face: the creator is history, and belongs where history is kept. So: assignees, then
 * reviewers, as two stacks side by side — the stack the call bar and every roster in WE draw. A
 * reviewer wears an amber ring (the `tone` the host function gives each part), drawn inside the face
 * so a ringed face is the size of the rest; no second glyph.
 *
 * ## Pressing the faces opens the picker
 *
 * Rather than a separate icon beside them: the thing you want to change is the thing you press, and a
 * card with nobody on it shows a dashed empty face in the same place, so unowned work is visible
 * while scanning and assigning it is one press. Both stacks are one trigger — two would leave a card
 * with no reviewer nothing to press to ask for one. The picker is `involvementMenu`.
 *
 * ## Hovering a stack says what that stack is
 *
 * A face alone names a person and not why they are there. Each stack has its own hovercard — the
 * assignees' lists who is doing it, the reviewers' who is checking it — rather than one card over
 * both, so what a reader points at is what they are told about. Where the card came from is not here:
 * that is about the card, and is on its extracted mark.
 */
function cardPeople(as: string, entity: string, edge?: string): SchemaNode {
  const on = ON(as);
  const faces = `${on}.people.filter(p, !p.reflexive)`;
  const doing = `${on}.people.filter(p, !p.reflexive && p.semantic != 'reviewing')`;
  const checking = `${on}.people.filter(p, !p.reflexive && p.semantic == 'reviewing')`;
  const face = (did: string) => `find(profileStore.profiles, { did: ${did} })`;

  /** A tooltip whose content is nodes — see `peopleTooltip` for why the slot is on a native div. */
  const hovercard = (content: SchemaNode[], trigger: SchemaNode): SchemaNode => ({
    type: 'we-tooltip',
    props: { placement: 'top' },
    children: [
      {
        type: 'div',
        slot: 'content',
        children: [{ type: 'Column', props: { gap: '300', minWidth: '160px', textAlign: 'left' }, children: content }],
      },
      trigger,
    ],
  });

  /** One stack's people, under the name of each part they hold — usually one part, in the community's words. */
  const roster = (people: string): SchemaNode => ({
    type: '$each',
    props: {
      items: { $: `spaceStore.involvementTypes.filter(k, count(${people}.filter(p, p.kind == k.slug)))` },
      as: 'part',
    },
    children: [
      {
        type: 'Column',
        props: { gap: '100' },
        children: [
          sectionLabel({ label: { $: 'part.name' } }),
          {
            type: '$each',
            props: { items: { $: `${people}.filter(p, p.kind == part.slug)` }, as: 'holder' },
            children: [
              {
                type: 'Row',
                props: { gap: '200', ay: 'center' },
                children: [
                  {
                    // A stack of one, so the ring comes from the same tone the card's stack uses.
                    type: 'AvatarStack',
                    props: {
                      size: 'xs',
                      avatars: { $: `[{ image: ${face('holder.did')}.avatar, hash: holder.did, tone: holder.tone }]` },
                    },
                  },
                  {
                    type: 'we-text',
                    props: {
                      fontSize: '200',
                      text: { $: `holder.did == me.did ? 'You' : ${face('holder.did')}.name` },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const stack = (people: string, max: number): SchemaNode => ({
    type: '$if',
    props: {
      condition: { $: `count(${people})` },
      then: hovercard([roster(people)], {
        type: 'AvatarStack',
        props: {
          size: 'xs',
          max,
          ...(edge ? { edge } : {}),
          avatars: { $: `${people}.map(p, { image: ${face('p.did')}.avatar, hash: p.did, tone: p.tone })` },
        },
      }),
    },
  });

  return {
    type: 'DropdownMenu',
    props: {
      triggerTitle: 'Who is on this',
      size: 'xs',
      itemSize: 'sm',
      placement: 'bottom-end',
      searchable: true,
      searchPlaceholder: 'Find a member',
      items: {
        $: `involvementMenu({ node: ${as}.id, entity: '${entity}', rows: local.involvements, types: spaceStore.offeredInvolvementTypes, members: spaceStore.members, profiles: profileStore.profiles, me: me.did, said: ${as}.assignee })`,
      },
      // A toggle reports the state it had before the press; "Assign to me" carries none, which reads as on.
      onSelect: {
        $action: 'spaceStore.setInvolvement',
        args: [{ $: `${as}.id` }, { $: 'arg.id' }, { $: 'arg.kind' }, { $: '!arg.checked' }],
      },
    },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: `count(${faces})` },
          /*
            Two stacks, not one: who is doing it, then who is checking it. One stack drew somebody in
            both parts once — a stack shows each person once — so being assigned *and* reviewing read
            as only one of them without hovering. Three doers and two checkers before a count, so a
            busy card does not grow wide. Edged in the card's own colour where the card is plain; a
            board with its own card colours gets no edge rather than a wrong one.
          */
          then: {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [stack(doing, 3), stack(checking, 2)],
          },
          // Nobody on it: a dashed empty face where the faces would be, which is also the way in.
          else: hovercard(
            [
              {
                type: 'we-text',
                props: {
                  fontSize: '200',
                  text: {
                    $: `${as}.assignee ? \`Nobody yet — the conversation named “\${${as}.assignee}”\` : 'Nobody is on this yet'`,
                  },
                },
              },
            ],
            // A dashed empty face, the size of a real one, so an unowned card reads as a place a person goes.
            // The colour and its hover on a row the icon inherits from: an icon has no hover state of its own.
            {
              type: 'Row',
              props: { color: 'text-faint', hoverProps: { color: 'text-muted' } },
              children: [{ type: 'we-icon', props: { name: 'user-circle-dashed', size: 'var(--we-avatar-size-xs)' } }],
            },
          ),
        },
      },
    ],
  };
}

/**
 * The menu that moves a card to another column.
 *
 * The keyboard path beside dragging, and the only way out of the unplaced column, which has no drop
 * zone to drag into. It offers this board's columns rather than the space's states, because those
 * are two different lists once a board owns its columns.
 *
 * One `onSelect` rather than a handler per item: the rows come from data, an expression yields
 * values, and a handler nested in a mapped object would be stored as the object rather than
 * resolved. The chosen row arrives as `arg`, carrying the target column's id.
 *
 * `from` is the column the card leaves, as an expression — `'col.id'` inside a column, `"''"` from
 * Unplaced, which has no placement to undo. `as` is the card's context key.
 */
export function moveTaskMenu(from: string, as = 'card'): SchemaNode {
  return {
    type: 'DropdownMenu',
    props: {
      triggerIcon: 'arrows-left-right',
      triggerTitle: 'Move this card',
      size: 'xs',
      items: { $: `${VIEW}.choices.map(k, { id: k.id, label: \`Move to \${k.label}\` })` },
      onSelect: {
        $action: 'spaceStore.moveCardToColumn',
        args: [{ $: from }, { $: 'arg.id' }, { $: `${as}.id` }, [], { $: `${VIEW}.contents[arg.id].slug` }],
      },
    },
  };
}

export interface TaskBoardOptions {
  /** The board's record id, as an expression. */
  boardId: SchemaProp;
  /** Shown when there is no work here at all. */
  empty: SchemaNode;
  /** Whether a card was extracted from a conversation, as an expression over `card` — see {@link TaskCardOptions.extracted}. */
  extracted?: string;
  /** Each card's fill, as an expression over `card` — see {@link TaskCardOptions.bg}. */
  bg?: SchemaProp;
  /**
   * What the board arranges. Defaults to `TaskBlock`, the one record with a `status` a column can
   * bind to. Anything else makes every column a lane — say so with `lanesOnly`.
   */
  entity?: string;
  /**
   * Draw what each card has collected — see {@link TaskCardOptions.social}.
   *
   * Declares what that needs as well as switching it on: the pool hydrates `signals`, and the board
   * hoists one `SignalType` subscription for every card on it rather than one per card. A board
   * supplying its own `card` gets those two and draws the counts itself.
   */
  social?: boolean;
  /** Extra conditions on the pool — `{ kind: 'post' }` for a board of composed cards. */
  where?: Record<string, unknown>;
  /**
   * How one card is drawn. Receives the context key the row is bound to. Defaults to
   * {@link taskCard} with a move menu, which is right for a `TaskBlock` and for nothing else.
   */
  card?: (as: string) => SchemaNode;
  /**
   * What the `+` on a column opens. Mounted inside each column with `col` in scope and a boolean
   * `local.addOpen` the button sets; close by setting it false. Defaults to a modal that names a new
   * task or brings in one that exists. A board of another record supplies its own — the showcase
   * opens the composer and arranges what it wrote through `spaceStore.moveCardToColumn`.
   */
  addCardModal?: SchemaNode;
  /**
   * Every column is a lane: no state to bind to, so no state picker when adding one, no state
   * shapes on headings, no Unplaced column, and no "lane" badge on every heading of a board where
   * that is the only kind. The containment kanban, as a special case of this one.
   */
  lanesOnly?: boolean;
  /**
   * Who is on the work: faces and an assign menu on every card, and a filter above the board that
   * dims, hides, or lays the board out a row per person.
   *
   * The chosen people ride in the address as `?who=`, so a link can say "look at what Ana is on"; how
   * the rest are drawn is remembered per device, since that is a way of reading rather than a thing
   * being pointed at. Off by default — a board of posts has nobody assigned to anything.
   */
  people?: boolean;
  /**
   * A switch above the board that puts away what extraction made and nobody has kept, with how many
   * there are. Agreed cards with a change suggested always show. The choice rides in the address as
   * `?suggestions=hide`, shared with any other page about the same call — see `suggestions.ts`.
   *
   * Every board already draws those records as provisional; this only lets a reader hide them. Offer
   * it wherever extraction can write onto the board.
   */
  suggestions?: boolean;
  /**
   * Pressing a card selects it, and the selected card is drawn in the accent.
   *
   * The board does not know what selection is *for* — the workshop's inspector reads it from the
   * address, which is also what the canvas writes — so the caller says where the selection lives and
   * what pressing a card does. Omit for a board with nothing to show a selected card in.
   */
  select?: CardSelection;
}

/**
 * Adding a card to the column somebody pressed `+` on — a new one, or work that already exists.
 *
 * Both, in one modal, because a curated board that could only hold work *born on it* would be nearly
 * as useless as one that showed everything: you could never build a sprint board out of a backlog.
 * The picker offers anything in scope this board does not already hold.
 *
 * The Pocket would be the nicer route for moving several cards between boards, and is deliberately
 * closed to a template: `modules.pocket.gather` is chrome-only, because the Pocket writes to the
 * agent's own root dataset and a space template arriving from a stranger must not be able to file
 * things there or enumerate what somebody keeps. The interaction it leaves open — a button that
 * opens the panel, and the person drags the card in themselves — needs the drag arbitration
 * `we-draggable` and `we-sortable` do not yet have, since both claim `pointerdown`. So: a picker.
 */
const addTaskModal: SchemaNode = formModal({
  open: { $: 'local.addOpen' },
  close: { $setLocal: 'addOpen', value: false },
  // Names the column, so a modal opened from the wrong `+` is obvious before anything is typed.
  title: { $: `\`Add to \${${CELL}.label}\`` },
  size: 'sm',
  localState: {
    addTitle: { type: 'string', initial: '' },
    addExisting: { type: 'string', initial: '' },
  },
  children: [
    field({ name: 'addTitle', label: 'What needs doing?', placeholder: 'Ship the docs' }),
    {
      type: 'we-form-field',
      props: { label: 'Or bring in work that already exists' },
      children: [
        {
          type: 'we-select',
          props: {
            placeholder: 'Nothing selected',
            searchable: true,
            value: { $: 'local.addExisting' },
            // Anything in scope this board is not already holding — the whole space for a made
            // board, and a call's work for a call's board.
            options: { $: `${VIEW}.available.map(t, { label: t.title, value: t.id })` },
            onChange: { $setLocal: 'addExisting', value: { $: 'event.detail' } },
          },
        },
      ],
    },
  ],
  disabled: { $: '!local.addTitle && !local.addExisting' },
  submitLabel: 'Add',
  /*
    One or the other. Bringing in an existing card is a *move into this column* — the same action a
    drag makes, so it writes the state the column names, exactly as dropping it there would.
    Creating one goes through `addTaskToColumn`, which parents it to the board's anchor as well so
    every other scoped surface finds it.
  */
  submit: {
    $if: {
      condition: { $: 'local.addExisting' },
      then: {
        $action: 'spaceStore.moveCardToColumn',
        args: ['', { $: 'col.id' }, { $: 'local.addExisting' }, [], { $: `${CELL}.slug` }],
        onSuccess: [{ $setLocal: 'addOpen', value: false }],
      },
      else: {
        $action: 'spaceStore.addTaskToColumn',
        args: [{ $: 'col.id' }, { $: 'local.addTitle' }, { $: ANCHOR }],
        onSuccess: [{ $setLocal: 'addOpen', value: false }],
      },
    },
  },
});

/** Renaming a column — the label on this board. Its slug, which is its meaning, is untouched. */
const renameModal: SchemaNode = formModal({
  open: { $: 'local.renameOpen' },
  close: { $setLocal: 'renameOpen', value: false },
  title: 'Rename column',
  size: 'sm',
  localState: { renameTitle: { type: 'string', initial: { $: `${CELL}.label` } } },
  children: [field({ name: 'renameTitle', label: 'Column name', placeholder: 'In review' })],
  disabled: { $: '!local.renameTitle' },
  submitLabel: 'Rename',
  submit: {
    $action: 'spaceStore.renameBoardColumn',
    args: [{ $: 'col.id' }, { $: 'local.renameTitle' }],
    onSuccess: [{ $setLocal: 'renameOpen', value: false }],
  },
});

/** The draggable box around a card: a native div, because that is what `we-sortable` reads. */
function draggable(card: SchemaNode, as: string): SchemaNode {
  /*
    A component's non-event props are assigned as DOM *properties*, so the `data-we-id` attribute
    `we-sortable` looks for would never exist on one. This div is also the box the drag geometry
    measures, hence the explicit width.
  */
  return {
    type: 'div',
    props: { 'data-we-id': { $: `${as}.id` }, style: { width: '100%', cursor: 'grab' } },
    children: [card],
  };
}

/** The default card for a column of this board — see `taskCard`. */
function boardCard(opts: TaskBoardOptions, showState: string, from: string): SchemaNode {
  return opts.card
    ? opts.card('card')
    : taskCard({
        actions: moveTaskMenu(from),
        extracted: opts.extracted,
        bg: opts.bg,
        showState,
        pending: `card.id in (${UNCONFIRMED})`,
        suggestions: true,
        dimmed: `card.id in ${VIEW}.dimmed`,
        ...(opts.select ? { select: opts.select } : {}),
        ...(opts.people ? { peopleOf: opts.entity ?? 'TaskBlock' } : {}),
        ...(opts.social ? { social: true } : {}),
      });
}

/**
 * The cards of one column, in a drop zone. Shared by every column, bound or lane, and by every cell of
 * a board laid out a row per person.
 *
 * `cell` is an expression for what to draw — `{ arranged, unarranged }` — and `group` says which zones
 * trade cards. A whole column trades with every column; a person's cell only with that person's
 * other cells, so dragging moves work between states and never between people, which is a menu's
 * job and a different claim.
 */
function columnCards(opts: TaskBoardOptions, cell: string, group: SchemaProp): SchemaNode {
  const card = boardCard(opts, `${CELL}.lane`, 'col.id');
  return {
    type: 'we-sortable',
    props: {
      // The zone is the column's **record id**, which is what makes a drop a two-line write: the
      // event says which zone the card landed in, and the store resolves both ends from those ids.
      zone: { $: 'col.id' },
      group,
      gap: 'var(--we-space-300)',
      /*
        The zone has to be the whole trough. A drop target is hit-tested by its own bounding
        rectangle, so a sortable holding nothing is a zero-height rectangle and nothing can be
        dropped into it — which is exactly the column you most need to drop into, an empty one.
      */
      flex: '1',
      width: '100%',
      /*
        The column's whole order goes with the drop, as the third argument. A column showing all of
        itself hands over the same list and nothing changes; one showing part — people hidden, or one
        person's row — would otherwise send every card it is not showing to the bottom, for everybody.
      */
      onReorder: {
        $action: 'spaceStore.arrangeColumn',
        args: [{ $: 'col.id' }, { $: 'arg.detail' }, { $: `${VIEW}.contents[col.id].order` }],
      },
      /*
        `ids` is the target column's whole new order, with the card already at the index it was
        dropped at — so a cross-column drop seats it where the pointer put it. Without it the store
        can only append, which is what "move to that column" means from the menu and not what a drag
        means.
      */
      /*
        The fifth argument is the state the target column stands for, and it is there for the
        *drawing* rather than for the write. A drop writes an order and a state; the store cannot
        know the state without reading the column, and until it does the card cannot be drawn in the
        column it was dropped into — the stale-hint rule would throw it straight back out. The board
        has the slug on screen already, so it says so and the card lands instantly. The store still
        reads the column for the write itself, so a stale hint costs a frame and never a wrong write.
      */
      onMoved: {
        $action: 'spaceStore.moveCardToColumn',
        args: [
          { $: 'arg.detail.from' },
          { $: 'arg.detail.to' },
          { $: 'arg.detail.id' },
          { $: 'arg.detail.ids' },
          { $: `${VIEW}.contents[arg.detail.to].slug` },
          { $: `${VIEW}.contents[arg.detail.to].order` },
        ],
      },
    },
    // Two loops, one continuous run of items: the arranged cards in their order, then whatever the
    // column's state gathers that nobody has placed.
    children: [
      { type: '$each', props: { items: { $: `${cell}.arranged` }, as: 'card' }, children: [draggable(card, 'card')] },
      { type: '$each', props: { items: { $: `${cell}.unarranged` }, as: 'card' }, children: [draggable(card, 'card')] },
    ],
  };
}

/**
 * A column's heading: its state's shape and name, how many cards it holds, and its controls.
 *
 * The count reads "2/5" while people are chosen — how many the chosen people are on, of how many
 * there are — in every mode, since that is the question the filter was opened to ask.
 */
function columnHeading(opts: TaskBoardOptions): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '200', ay: 'center', width: '100%' },
    children: [
      // The state's shape — the community's icon, or the one its semantic implies. A lane
      // stands for no state and so has none.
      ...(opts.lanesOnly
        ? []
        : [
            {
              type: '$if',
              props: {
                condition: { $: `!${CELL}.lane` },
                then: {
                  type: 'we-icon',
                  props: { name: { $: `${CELL}.icon` }, size: 'xs', color: { $: `${CELL}.color` } },
                },
              },
            },
          ]),
      {
        type: 'we-text',
        props: {
          variant: 'footnote',
          uppercase: true,
          truncate: true,
          // A lane claims no shared meaning, so it takes no state colour.
          color: { $: `${CELL}.color` },
        },
        children: [{ $: `${CELL}.label` }],
      },
      // Says which columns propagate and which do not, at the only moment it matters — and
      // not on a board where every column is a lane, where it would say nothing.
      ...(opts.lanesOnly
        ? []
        : [
            {
              type: '$if',
              props: {
                condition: { $: `${CELL}.lane` },
                then: {
                  type: 'we-tooltip',
                  props: { content: 'A lane on this board only — dropping a card here changes no state' },
                  children: [
                    {
                      type: 'we-badge',
                      props: {
                        size: 'xs',
                        variant: 'neutral',
                      },
                      children: ['lane'],
                    },
                  ],
                },
              },
            },
          ]),
      {
        type: 'we-text',
        props: {
          variant: 'footnote',
          color: 'text-muted',
          ml: 'auto',
          text: { $: `${CELL}.matched != ${CELL}.count ? \`\${${CELL}.matched}/\${${CELL}.count}\` : ${CELL}.count` },
        },
      },
      {
        type: 'we-tooltip',
        props: { content: { $: `\`Add a card to \${${CELL}.label}\`` } },
        children: [
          {
            type: 'we-button',
            props: {
              label: { $: `\`Add a card to \${${CELL}.label}\`` },
              variant: 'ghost',
              size: 'xs',
              square: true,
              onClick: { $setLocal: 'addOpen', value: true },
            },
            children: [{ type: 'we-icon', props: { name: 'plus' } }],
          },
        ],
      },
      {
        type: 'DropdownMenu',
        props: {
          triggerIcon: 'dots-three',
          triggerTitle: 'Column options',
          size: 'xs',
          items: [
            { id: 'rename', label: 'Rename' },
            { id: 'remove', label: 'Remove column', variant: 'danger' },
          ],
          onSelect: [
            {
              $if: {
                condition: { $: "arg.id == 'rename'" },
                then: { $setLocal: 'renameOpen', value: true },
                // Removing takes the column record and nothing else: the cards keep their
                // state, so they reappear in another column bound to it or in Unplaced.
                else: {
                  $action: 'spaceStore.removeBoardColumn',
                  args: [opts.boardId, { $: 'col.id' }],
                },
              },
            },
          ],
        },
      },
    ],
  };
}

/** One column: its heading and controls, and the cards in it. */
function column(opts: TaskBoardOptions): SchemaNode {
  return {
    type: 'div',
    /*
      The column is an item of the board's own sortable, so it carries the id that one drags by — and
      the *whole* column drags, not a grip on its heading.

      No `data-we-handle`, because nesting already arbitrates: the cards' sortable sits inside this
      element and claims the press through `dragSession` before this one sees it. So pressing a card
      drags the card, and pressing anywhere else — the heading, the padding, the empty trough below
      the cards — drags the column. A handle was narrower than that and, worse, invisible: nothing on
      screen said the heading could be dragged at all, which is what `cursor: grab` now says.
    */
    props: { 'data-we-id': { $: 'col.id' }, style: { flex: '0 0 auto', cursor: 'grab' } },
    children: [
      {
        type: 'Column',
        // One per column, because the modals are inside the `$each` — which is also what makes
        // per-column state possible without a name per column, since `$localState` names are fixed
        // when a schema is written and the columns are data.
        $localState: {
          addOpen: { type: 'boolean', initial: false },
          renameOpen: { type: 'boolean', initial: false },
        },
        props: {
          /*
            A column has to read as a *trough* even when empty, or a board with one card in it looks
            like a card with a stray heading. Sunken is right here and the cards inside it are
            `surface`: the column is the one place on the route genuinely recessed into the page.
          */
          width: '300px',
          minHeight: '240px',
          gap: '300',
          bg: 'surface-sunken',
          border: '1px solid border',
          r: '400',
          p: '300',
          ay: 'start',
        },
        children: [
          columnHeading(opts),
          opts.addCardModal ?? addTaskModal,
          renameModal,
          columnCards(opts, CELL, 'board-cards'),
        ],
      },
    ],
  };
}

/** Work no column here claims — shown only when there is some, and cleared by dragging out of it. */
function unplacedColumn(opts: TaskBoardOptions): SchemaNode {
  const card = boardCard(opts, 'true', "''");
  return {
    type: '$if',
    props: {
      condition: { $: `count(${VIEW}.unplaced)` },
      then: {
        type: 'Column',
        props: {
          width: '300px',
          minHeight: '240px',
          flex: '0 0 auto',
          gap: '300',
          bg: 'surface-sunken',
          border: '1px dashed border-strong',
          r: '400',
          p: '300',
          ay: 'start',
        },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center', width: '100%' },
            children: [
              {
                type: 'we-text',
                props: { variant: 'footnote', uppercase: true, color: 'warning-text' },
                children: ['Unplaced'],
              },
              {
                type: 'we-text',
                props: { variant: 'footnote', color: 'text-muted', ml: 'auto', text: { $: `count(${VIEW}.unplaced)` } },
              },
            ],
          },
          {
            type: 'we-text',
            props: { fontSize: '200', color: 'text-muted' },
            children: [
              'This board has no column for the state these are in. Move them somewhere it does, or give them one.',
            ],
          },
          /*
            A column for the state, in one click. The state was named after this board was made, or
            somebody wrote it through another surface; either way the work is real and the board can
            simply grow to fit it. Offered here rather than fanned out to every board when a state is
            named, because a board somebody made is theirs to shape.
          */
          {
            type: '$each',
            props: { items: { $: `${VIEW}.unplacedStates` }, as: 'state' },
            children: [
              {
                type: 'we-button',
                props: {
                  variant: 'secondary',
                  size: 'xs',
                  width: '100%',
                  onClick: {
                    $action: 'spaceStore.addBoardColumn',
                    args: [opts.boardId, { $: 'state.name' }, { $: 'state.slug' }],
                  },
                },
                children: [
                  { type: 'we-icon', props: { name: 'plus' } },
                  { type: 'we-text', children: [{ $: '`Add a column for ${state.name}`' }] },
                ],
              },
            ],
          },
          /*
            A zone you can drag *out* of and never into.

            `locked` refuses incoming drops while leaving the press that starts a drag alone, which is
            exactly the asymmetry this column wants: there is no state to drop *into* here, so taking
            a card would mean taking it and doing nothing. Dragging a card *out* is the rescue, and
            without it the only way out was the menu, which puts a card at the end of its new column
            and needs a second drag to place it. The card's menu stays for the keyboard.
          */
          {
            type: 'we-sortable',
            props: {
              zone: 'unplaced',
              group: 'board-cards',
              locked: true,
              gap: 'var(--we-space-300)',
              width: '100%',
              flex: '1',
              /*
                The drop is reported on the zone the card *left*, so this column needs its own
                handler — its events do not bubble to a shared one above, which is what stops a card
                drag rewriting the board's columns.

                No `from`, given literally rather than forwarded: `arg.detail.from` is this zone's
                *name*, and a name is not a record id — the backend would try to parse it as an IRI
                and refuse the whole query. There is nothing to unlink anyway: a card here has no
                placement to undo. What matters is the target, which arranges the card and — being a
                bound column — writes its state.
              */
              onMoved: {
                $action: 'spaceStore.moveCardToColumn',
                args: [
                  '',
                  { $: 'arg.detail.to' },
                  { $: 'arg.detail.id' },
                  { $: 'arg.detail.ids' },
                  { $: `${VIEW}.contents[arg.detail.to].slug` },
                  { $: `${VIEW}.contents[arg.detail.to].order` },
                ],
              },
            },
            children: [
              {
                type: '$each',
                props: { items: { $: `${VIEW}.unplaced` }, as: 'card' },
                children: [draggable(card, 'card')],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * The way to add a column: a square "+" just after the last one.
 *
 * Where the column it makes will appear, which is what every board that has settled this does, and
 * which is why it is not in the controls above the board — those are about how the board is read, and
 * this changes what the board is. It used to sit under the board with a sentence about states and
 * lanes; the sentence is the add-column form's to say, where somebody is choosing between the two.
 *
 * `pt` lines it up with a column's heading, which sits inside the trough's own padding.
 */
function addColumnButton(pt: string): SchemaNode {
  return {
    type: 'Column',
    props: { pt, flexShrink: '0' },
    children: [
      {
        type: 'we-tooltip',
        props: { content: 'Add column' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'secondary',
              size: 'xs',
              square: true,
              label: 'Add column',
              onClick: { $setLocal: 'addColumnOpen', value: true },
            },
            children: [{ type: 'we-icon', props: { name: 'plus' } }],
          },
        ],
      },
    ],
  };
}

/**
 * A column's heading on its own, for a board laid out a row per person — where the cards live in the
 * rows below and the heading is drawn once, above all of them.
 *
 * Still an item of the columns' sortable, so a column is dragged by its heading here exactly as it is
 * by its whole trough on an ordinary board.
 */
function columnHead(opts: TaskBoardOptions): SchemaNode {
  return {
    type: 'div',
    props: { 'data-we-id': { $: 'col.id' }, style: { flex: '0 0 auto', cursor: 'grab' } },
    children: [
      {
        type: 'Column',
        $localState: {
          addOpen: { type: 'boolean', initial: false },
          renameOpen: { type: 'boolean', initial: false },
        },
        props: { width: '300px', bg: 'surface-sunken', border: '1px solid border', r: '400', px: '300', py: '200' },
        children: [columnHeading(opts), opts.addCardModal ?? addTaskModal, renameModal],
      },
    ],
  };
}

/** The key of the row for work nobody is on, as `arrangedBoard` names it. */
const NOBODY = "'nobody'";

/**
 * The board laid out a row per person: the headings once across the top, then a band per person — and
 * one for work nobody is on — crossing every column.
 *
 * A card several people are on is in each of their rows, which is true, and is why each band says its
 * own count rather than a share of the column's. Each band's cells trade cards only with each other,
 * so a drag changes state and never who is on the work; the card's own menu does that, as the claim
 * it is.
 *
 * The gutter is a fixed width so every band's cells line up under the headings, which a board of
 * 300px columns needs more than it needs the space.
 */
function personRows(opts: TaskBoardOptions): SchemaNode {
  const gutter = '180px';
  const name = 'find(profileStore.profiles, { did: person }).name';
  return {
    type: 'Column',
    props: { gap: '300', ay: 'start' },
    children: [
      {
        type: 'Row',
        props: { gap: '400', ay: 'start' },
        children: [
          { type: 'div', props: { style: { width: gutter, flex: '0 0 auto' } } },
          {
            type: 'we-sortable',
            props: {
              direction: 'horizontal',
              zone: 'columns',
              group: 'board-columns',
              gap: 'var(--we-space-400)',
              ay: 'start',
              onReorder: { $action: 'spaceStore.reorderBoardColumns', args: [opts.boardId, { $: 'arg.detail' }] },
            },
            children: [
              { type: '$each', props: { items: { $: `${VIEW}.columns` }, as: 'col' }, children: [columnHead(opts)] },
            ],
          },
          addColumnButton('200'),
        ],
      },
      {
        type: '$each',
        props: { items: { $: `${VIEW}.rows` }, as: 'person' },
        children: [
          {
            type: 'Row',
            props: { gap: '400', ay: 'stretch' },
            children: [
              {
                type: 'Row',
                props: { width: gutter, flex: '0 0 auto', gap: '300', ay: 'start', pt: '300' },
                children: [
                  {
                    type: '$if',
                    props: {
                      condition: { $: `person == ${NOBODY}` },
                      then: { type: 'we-icon', props: { name: 'user-circle-dashed', size: 'md', color: 'text-faint' } },
                      else: {
                        type: 'we-avatar',
                        props: {
                          size: 'sm',
                          image: { $: 'find(profileStore.profiles, { did: person }).avatar' },
                          hash: { $: 'person' },
                        },
                      },
                    },
                  },
                  {
                    type: 'Column',
                    props: { flex: '1', minWidth: '0' },
                    children: [
                      {
                        type: 'we-text',
                        props: {
                          fontWeight: 'semibold',
                          truncate: true,
                          text: {
                            $: `person == ${NOBODY} ? 'Nobody yet' : person == me.did ? ${name} + ' (you)' : ${name}`,
                          },
                        },
                      },
                      {
                        type: 'we-text',
                        props: {
                          variant: 'footnote',
                          color: 'text-muted',
                          text: {
                            $: `\`\${${VIEW}.rowCounts[person]} \${plural(${VIEW}.rowCounts[person], 'card', 'cards')}\``,
                          },
                        },
                      },
                    ],
                  },
                ],
              },
              {
                type: 'Row',
                props: { gap: '400', ay: 'stretch' },
                children: [
                  {
                    type: '$each',
                    props: { items: { $: `${VIEW}.columns` }, as: 'col' },
                    children: [
                      {
                        type: 'Column',
                        props: {
                          width: '300px',
                          minHeight: '120px',
                          flex: '0 0 auto',
                          gap: '300',
                          bg: 'surface-sunken',
                          border: '1px solid border',
                          r: '400',
                          p: '300',
                          ay: 'start',
                        },
                        children: [
                          columnCards(opts, `${VIEW}.cells[person][col.id]`, { $: "'board-cards-' + person" }),
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Adding a column — a state everybody shares, or a lane of this board's own. */
function addColumnModal(opts: TaskBoardOptions): SchemaNode {
  return formModal({
    open: { $: 'local.addColumnOpen' },
    close: { $setLocal: 'addColumnOpen', value: false },
    title: 'New column',
    size: 'sm',
    localState: {
      columnName: { type: 'string', initial: '' },
      /*
        Empty means a lane. The picker offers the space's states this board does not yet have, so
        the ordinary case — "this board should also show Blocked" — is one choice rather than a name
        somebody has to spell the same way twice.
      */
      columnSlug: { type: 'string', initial: '' },
    },
    children: [
      ...(opts.lanesOnly
        ? []
        : [
            {
              type: 'we-form-field',
              props: {
                label: 'A state everyone shares',
                description:
                  'Cards dropped here change state on every board. Leave empty for a lane on this board only.',
              },
              children: [
                {
                  type: 'we-select',
                  props: {
                    placeholder: 'A lane on this board only',
                    value: { $: 'local.columnSlug' },
                    options: { $: `${VIEW}.unboundStates.map(s, { label: s.name, value: s.slug })` },
                    // Naming the state names the column, so the common case needs one choice, not two.
                    onChange: [
                      { $setLocal: 'columnSlug', value: { $: 'event.detail' } },
                      {
                        $setLocal: 'columnName',
                        value: { $: 'find(spaceStore.taskStates, { slug: event.detail }).name' },
                      },
                    ],
                  },
                },
              ],
            },
          ]),
      field({
        name: 'columnName',
        label: 'Column name',
        placeholder: opts.lanesOnly ? 'In progress' : 'Waiting on Ana',
      }),
    ],
    disabled: { $: '!local.columnName' },
    submitLabel: 'Add column',
    submit: {
      $action: 'spaceStore.addBoardColumn',
      args: [opts.boardId, { $: 'local.columnName' }, { $: 'local.columnSlug' }],
      onSuccess: [{ $setLocal: 'addColumnOpen', value: false }],
    },
  });
}

/**
 * What a board shows while it is being asked for — a spinner, at a column's height so the board does
 * not jump when it arrives.
 *
 * Exported so a surface that gates on *whether there is a board* can show the same thing while that
 * question is still open. The Workshop's kanban route showed "this call has no board yet" for the
 * frames before the call record had answered, then this spinner, then the board: two loading states
 * that looked like three, one of them asserting something false. Sharing the node makes the handoff
 * invisible — same spinner, same place, until the board is there.
 */
export const taskBoardLoading: SchemaNode = {
  type: 'Column',
  props: { width: '100%', minHeight: '240px', ax: 'center', ay: 'center' },
  children: [{ type: 'we-spinner', props: { size: 'lg' } }],
};

export function taskBoard(opts: TaskBoardOptions): SchemaNode {
  return {
    type: 'Column',
    props: { width: '100%', gap: '300' },
    $localState: {
      addColumnOpen: { type: 'boolean', initial: false },
      /*
        Declared on every board, so the one expression every list reads can always name them; a board
        without `people` simply never changes them, and `arrangedBoard` filters nothing for nobody.
        The people ride in the address and the mode stays on the device — see `TaskBoardOptions.people`.
      */
      boardPeople: { type: 'array', initial: [], ...(opts.people ? { syncParam: 'who' } : {}) },
      boardShow: { type: 'string', initial: 'dim', ...(opts.people ? { persist: 'board.show' } : {}) },
      // A row per person, or one board — its own choice now, beside rather than inside dim and hide.
      boardGrouped: { type: 'boolean', initial: false, ...(opts.people ? { persist: 'board.grouped' } : {}) },
    },
    /*
      Three subscriptions for the whole board, read together through `arrangedBoard`.

      `board` and `columns` bring the structure back — the order from one, the contents from the
      other; `arrangedBoard`'s docblock says why two. `pool` is the membership side: everything in
      scope, narrowed to what the board gathers from where that is a container.
    */
    $queries: {
      /*
        The board, hydrated one level. A second hop through a polymorphic relation cannot be
        hydrated — the ORM does not know what class the columns are until it has read them — which is
        why a column's cards are ids here and resolved against the pool.
      */
      board: {
        entity: 'CollectionBlock',
        where: { id: opts.boardId as Record<string, unknown> },
        include: { children: true },
        limit: 1,
      },
      /* The columns as records of their own, so a change to one is a change this query is watching. */
      columns: {
        entity: 'CollectionBlock',
        where: { kind: 'column' },
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: opts.boardId as Record<string, unknown> },
      },
      /*
        Everything in scope, unbounded. A limit here was the one place this design broke its own
        rule: the card past it did not land in Unplaced, it vanished. A board that has outgrown one
        subscription wants paging, which is a different feature; until then, all of it.
      */
      pool: {
        entity: opts.entity ?? 'TaskBlock',
        ...(opts.where && { where: opts.where }),
        // Hydrated only where the cards draw them: an include nobody reads is rows of links fetched
        // for every card on the board. `comments` needs none — a relation's own ids arrive anyway,
        // which is what lets a reply count cost nothing.
        ...(opts.social && { include: { signals: true } }),
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: ANCHOR } },
        order: { createdAt: 'asc' },
        /*
          Not asked until the board has answered. The anchor is read off the board record, and an
          unresolved anchor is pruned — which widens the query to the whole space. Without this the
          pool ran once unscoped, drew everybody's work, and re-ran narrowed a frame later.
        */
        when: { $: 'local.boardLoaded' },
      },
      /*
        Who is on what, space-wide. Not scoped to the pool: an involvement is not a child of anything,
        and the rows are a person's deliberate claims, so there are as many as people have made. Never
        asked on a board without `people`, which leaves it empty and every card undimmed.
      */
      involvements: { entity: 'Involvement', ...(opts.people ? {} : { when: { $: 'false' } }) },
      /*
        What this community reacts with, for the counts on every card — one subscription for the
        board. Declared here rather than by the route, so a board that draws them cannot be placed
        without them: the reads resolve to nothing, every count reads zero, and nothing says why.
      */
      ...(opts.social ? { signalTypes: { entity: 'SignalType', subscribe: true } } : {}),
    },
    children: [
      addColumnModal(opts),
      /*
        The board's header: who, then whether suggestions show — in that order, the second after the
        other controls. One wrapping row, so the switch sits beside the people filter while there is
        room and drops under it when there is not.
      */
      ...(opts.people || opts.suggestions
        ? [
            {
              type: 'Row',
              props: { gap: '500', ay: 'center', wrap: true, width: '100%' },
              children: [
                ...(opts.people
                  ? [
                      peopleFilter({
                        people: 'boardPeople',
                        show: 'boardShow',
                        grouped: 'boardGrouped',
                        faces: { $: `${VIEW}.involved` },
                        matched: { $: `${VIEW}.matchedCount` },
                        total: { $: `${VIEW}.cardCount` },
                        noun: 'card',
                      }),
                    ]
                  : []),
                ...(opts.suggestions
                  ? [suggestionsToggle({ count: `count(local.pool.filter(r, r.id in ${UNCONFIRMED}))` })]
                  : []),
              ],
            } as SchemaNode,
          ]
        : []),
      {
        type: '$if',
        props: {
          /*
            Nothing is shown until all three subscriptions have answered, and then the board fades in
            once, in its final shape. Each subscription answering at its own moment was three states
            on the way to one: the empty state (board in, columns not yet), then whatever the pool held
            before it narrowed, then the board. A spinner for the wait and a fade for the arrival, so
            what a person sees change is the board appearing rather than the board correcting itself.
          */
          condition: { $: 'local.boardLoaded && local.columnsLoaded && local.poolLoaded' },
          enterTransition: { type: 'fade', duration: 250 },
          then: {
            type: '$if',
            props: {
              /*
                The columns decide whether there is a board to show, not the work. A made board is
                meant to start empty, so the honest answer for a board with no columns is the empty
                state — and by now every query has answered, so it is an answer.
              */
              condition: { $: `count(${VIEW}.columns)` },
              then: {
                type: '$if',
                props: {
                  condition: { $: `${VIEW}.show == 'rows'` },
                  then: {
                    type: 'Row',
                    props: { width: '100%', gap: '400', ay: 'start', overflowX: 'auto' },
                    children: [personRows(opts), ...(opts.lanesOnly ? [] : [unplacedColumn(opts)])],
                  },
                  else: {
                    type: 'Row',
                    props: { width: '100%', gap: '400', ay: 'start', overflowX: 'auto' },
                    children: [
                      {
                        type: 'we-sortable',
                        props: {
                          // The columns are themselves a sortable, in its own group so a card can never
                          // be dropped among them.
                          direction: 'horizontal',
                          zone: 'columns',
                          group: 'board-columns',
                          gap: 'var(--we-space-400)',
                          ay: 'start',
                          onReorder: {
                            $action: 'spaceStore.reorderBoardColumns',
                            args: [opts.boardId, { $: 'arg.detail' }],
                          },
                        },
                        children: [
                          {
                            type: '$each',
                            props: { items: { $: `${VIEW}.columns` }, as: 'col' },
                            children: [column(opts)],
                          },
                        ],
                      },
                      // After the last column and before Unplaced, which is not one of the board's own.
                      addColumnButton('300'),
                      // Outside the sortable, because it is not one of the board's columns: it has no
                      // record and no id to reorder, and inside it looked draggable and did nothing.
                      ...(opts.lanesOnly ? [] : [unplacedColumn(opts)]),
                    ],
                  },
                },
              },
              // A board with no columns has no last column to add after, so the empty state offers it.
              else: {
                type: 'Column',
                props: { width: '100%', ax: 'center', gap: '300' },
                children: [
                  opts.empty,
                  {
                    type: 'we-button',
                    props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'addColumnOpen', value: true } },
                    children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add column'],
                  },
                ],
              },
            },
          },
          else: taskBoardLoading,
        },
      },
    ],
  };
}
