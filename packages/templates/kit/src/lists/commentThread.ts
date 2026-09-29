/**
 * Replies hanging off a node, recursively.
 *
 * ## Why replies are not `children`
 *
 * A post's `children` slot is already occupied — by the post's own content, the blocks it is made
 * of. So a reply cannot go there, and it does not need to: `WeNode.comments` (`we://comment`) has
 * existed since the beginning with no consumers, and it is exactly the right edge. The two say
 * different things — `we://children` is what a thing is *made of*, `we://comment` is what others
 * *said about it* — and keeping them apart is what lets a reply be a full composition (with its own
 * children, its own blocks) rather than a string.
 *
 * Because the edge is on `WeNode` rather than on any one model, a reply can hang off anything: a
 * post, an image block inside it, a video, or another reply. Threads are fractal for free, which is
 * why this fragment recurses.
 *
 * ## Depth
 *
 * Recursion is bounded at authoring time — the fragment expands into `depth` nested copies of
 * itself, because a schema is a finite tree and cannot recurse at render time. Past the limit,
 * deeper replies exist and are simply not drawn; the last level shows a count so the thread does
 * not appear to end. Three is the default for the same reason every threaded UI picks something
 * near it: the indent budget runs out before the conversation does.
 */
import type { AnchorId } from '@we/schema-kit';
import { emptyNote } from '@we/schema-kit';
import type { QueryStateField, SchemaNode, SchemaProp } from '@we/schema-shared';

export interface CommentThreadOptions {
  /** Id of the node being replied to — a post, a block, or a reply one level up. */
  anchorId: AnchorId;
  /**
   * Renders one reply. Receives the context key below, and an expression that is true while this
   * reply is folded — see {@link CommentThreadOptions.collapsible}.
   *
   * The fold is split between the two because the pieces belong to different owners: this fragment
   * hides what it draws (the replies underneath), and the caller hides what *it* draws (the words),
   * usually leaving the byline as the stub. Handing over the expression is what lets both read one
   * answer rather than keeping two flags in step.
   */
  reply: (as: string, collapsed: string) => SchemaNode[];
  /** Context key for each reply. Defaults to `'reply'`; nested levels get `reply2`, `reply3`, … */
  as?: string;
  /** How many levels to expand. Defaults to 3. */
  depth?: number;
  /** Shown when a thread has no replies. Defaults to nothing — an empty thread should be silent. */
  empty?: SchemaNode;
  /**
   * What to draw at the depth limit, in place of the default "N more in this thread". Receives the
   * context key of the deepest reply drawn, whose own replies are the ones not being shown.
   *
   * The default is a sentence, because a fragment on its own has nowhere to send anybody: the count
   * says the conversation continues and stops there. A caller that *can* go there — one holding a
   * local for which reply the thread is rooted at — passes a control instead, and the limit stops
   * being a wall. See `discussionSection`, which is that caller.
   *
   * Rendered inside the same `count(<reply>.comments)` guard as the default, so a thread that simply
   * ends still ends: this replaces what is said, never whether anything is.
   */
  more?: (as: string) => SchemaNode;
  /**
   * Fold a reply and everything under it, from a caret and a rail in a gutter down its left.
   *
   * The rail is the affordance worth having and the reason this is a gutter rather than a border: a
   * line down the left of a branch says how deep you are, and Reddit's makes it a *target* — press
   * anywhere along it and the branch folds. A border cannot take a press, so the line is a control
   * filling a column, with the caret above it.
   *
   * ## Which ids are folded, rather than a flag per row
   *
   * The state is an array of reply ids on the outermost thread, toggled with `$toggleLocalIn`. The
   * obvious alternative — a boolean `$localState` on each row, the way a row holds whether the
   * pointer is on it — loses the fold at the worst moment: rows come from a subscription, so when
   * anybody replies anywhere the query answers again, `<For>` sees new objects, and every row
   * remounts with its state reset. Somebody would watch a branch they had folded spring open because
   * a stranger wrote something else. Keyed by id, a remount changes nothing.
   *
   * Declared once, at the top: the nested levels read the same local rather than shadowing it, which
   * is what lets a caret three levels down fold a branch the top level is drawing.
   */
  collapsible?: boolean;
  /** Indent per level, as a space token. Defaults to `'400'`. Ignored when `collapsible` — the gutter indents. */
  indent?: string;
  /**
   * How many replies to fetch at each depth, per parent — `[10, 5, 3]` by default.
   *
   * The thread is one question: the backend walks it depth by depth and answers once, so the rows
   * arrive together instead of a level at a time, and the work is bounded at every depth rather
   * than by a cap on the total. One branch that attracted three hundred replies cannot crowd out
   * the rest of the conversation.
   *
   * The first entry is the top level and there is no per-parent distinction there, since there is
   * one parent. Levels beyond `depth` are fetched and not drawn, so the list is trimmed to it.
   *
   * Needs a backend declaring `boundedTraversal.levelWalk`; where one does not the query is refused
   * rather than quietly answered some other way.
   */
  perLevel?: number[];
  /**
   * How many direct replies the anchor has, as an expression — `count(card.comments)`.
   *
   * Only the top level needs telling. Every level below it is drawn under a reply that is itself on
   * screen, and a row carries its own `comments` ids, so the count is already to hand there.
   *
   * Without it the top level cannot tell "ten shown because ten is all there is" from "ten shown
   * because ten is the limit", and the choice is between offering more that may not exist and
   * saying nothing when it does.
   */
  anchorTotal?: string;
  /** Internal: the current level, counted down. */
  level?: number;
}

/**
 * How many replies are under this one, all the way down.
 *
 * Falls back to the direct-child count where the backend cannot walk a path, which reads low rather
 * than wrong — a thread that says "2 more" over nine is unhelpful; one that says nothing is worse.
 */
export const descendantCount = (as: string): string => `${as}.$descendants ?? count(${as}.comments)`;

/** Which replies are folded, by id — declared on the outermost thread. See `collapsible`. */
const COLLAPSED = 'collapsedReplies';

/** Whether the pointer is anywhere on one reply's fold line. See {@link railHighlight}. */
const RAIL_HOT = 'railHot';

/**
 * The props that make a segment of the fold line light up with the rest of it.
 *
 * The line is drawn by two fragments — the part beside a comment's words belongs to the reply, the
 * part beside its replies belongs to the thread — because they sit in different places in the tree.
 * With `hoverProps` each lit on its own, so a line that reads as one thing highlighted in halves.
 *
 * A shared local instead of CSS, since CSS has no way to say "while the pointer is on my sibling".
 * Declared per row, inside the `$each`, so two replies cannot disagree about whose line is lit.
 */
/**
 * The rule itself — one drawing, used by both segments of the line.
 *
 * A hairline is a mark, not a control, and nothing about 1px of `border` says it can be pressed. So
 * it answers the pointer: thicker, and on the role for the edge of an interactive box rather than
 * the one for an ordinary divider. That is what took over from the caret that used to sit above it
 * — the caret said "this folds" at rest and said it twice, since a folded comment's stub carries
 * one already; the line says it on approach, which is when it is being asked.
 *
 * Both segments read `railHot`, so the part beside the words and the part beside the replies
 * thicken together. They are one line and were only ever drawn in two places because they sit in
 * different places in the tree.
 */
export function railLine(): SchemaNode {
  return {
    type: 'Column',
    props: {
      width: { $: `local.${RAIL_HOT} ? '2px' : '1px'` },
      height: '100%',
      bg: { $: `local.${RAIL_HOT} ? 'border-hover' : 'border'` },
    },
  };
}

export function railHighlight(): Record<string, unknown> {
  return {
    onMouseEnter: { $setLocal: RAIL_HOT, value: true },
    onMouseLeave: { $setLocal: RAIL_HOT, value: false },
    bg: { $: `local.${RAIL_HOT} ? 'surface-hover' : ''` },
  };
}

/**
 * How many top-level replies to fetch — a local, so "show more" raises it.
 *
 * Only the top level grows. A deeper one is reached by opening the branch it is in, which re-roots
 * the thread there and gives it the top level's budget; adding a second way to widen every depth in
 * place would be two mechanisms for one want.
 */
const TOP_LIMIT = 'topReplies';

/** The one query a thread makes, and the local its rows arrive in. */
const WHOLE_THREAD = 'threadRows';

/**
 * Replies per parent at each depth, absent a caller's own.
 *
 * Narrowing as it descends, the way a conversation does: the top of a thread is what most people
 * read, and a reply nine deep is being followed by whoever is in that exchange. See
 * {@link CommentThreadOptions.perLevel}.
 */
const DEFAULT_PER_LEVEL = [10, 5, 3];

/**
 * An anchor as an expression, whether it was written as a token or a literal id.
 *
 * **Parenthesised, always.** The caller's anchor is an arbitrary expression — `discussionSection`
 * passes a ternary, because the thread can be re-rooted on a reply — and `==` binds tighter than
 * `?:`. Spliced in bare, `r.inReplyTo.id == a ? a : b` parses as `(r.inReplyTo.id == a) ? a : b`,
 * so the filter's predicate becomes the ternary's *result*: a non-empty id, which is truthy for
 * every row. Every descendant then passed the top level's filter and the whole thread drew flat.
 */
function anchorExpr(anchorId: AnchorId): string {
  if (anchorId && typeof anchorId === 'object') {
    const token = (anchorId as { $?: unknown }).$;
    if (typeof token === 'string') return `(${token})`;
  }
  return typeof anchorId === 'number' ? String(anchorId) : `'${String(anchorId)}'`;
}

/** What every row carries, whichever way the thread is read. */
const THREAD_INCLUDE = {
  signals: true,
  // The parent each row names — what puts a flat answer back into a tree.
  inReplyTo: true,
  // What a folded branch or a depth limit says is below it. Transitive, because "3 more in this
  // thread" above nine replies is a number nobody can act on, and it rides in the read already
  // being made: the projection is grouped per row and asked of every row at once.
  $descendants: { from: 'comments', count: true, transitive: true },
} as const;

/**
 * What a level says when it is showing fewer replies than exist.
 *
 * Counted, not guessed. A row carries its own `comments` — the ids of its direct replies — so how
 * many a level *could* draw is already in hand, and comparing it against how many it *did* is
 * exact. The first version tested whether a level came back full, which cannot tell "ten shown
 * because ten is the limit" from "ten shown because ten is all there is", and so offered more that
 * sometimes revealed nothing. A control that does nothing reads as a bug, and is one.
 *
 * The top level is the exception, having no row of its own: its total comes from the caller, which
 * knows what the thread is anchored to. Absent that, it says nothing rather than guessing.
 *
 * The top level grows in place, because it is the level being read. A deeper one offers its branch
 * instead: re-rooting gives it the top level's budget, which is both more room and a better place
 * to read it from. Where the caller has given no way to re-root, a deeper level stays quiet — a
 * note leading nowhere is worse than none.
 */
function truncationNote(opts: CommentThreadOptions, level: number, itemsExpr: string): SchemaNode {
  const parentAs = level === 2 ? (opts.as ?? 'reply') : `${opts.as ?? 'reply'}${level - 1}`;
  const total = level === 1 ? opts.anchorTotal : `count(${parentAs}.comments)`;
  const silent: SchemaNode = { type: '$if', props: { condition: { $: 'false' } } };
  if (!total) return silent;

  // Parenthesised for the same reason the anchor is: `total` is the caller's expression and may be
  // anything — `discussionSection` passes a ternary, since the thread can be re-rooted. Spliced in
  // bare, `a ? b : c - count(…)` parses as `a ? b : (c - count(…))`, so the re-rooted branch yields
  // the total instead of what is left over, and a thread showing everything it had still offered
  // more. Interpolating a caller's expression without brackets has now been wrong three times.
  const hidden = `(${total}) - count(${itemsExpr})`;
  const condition = { $: `${hidden} > 0` };

  if (level > 1) {
    return opts.more ? { type: '$if', props: { condition, then: opts.more(parentAs) } } : silent;
  }
  /*
    Whether the backend is still answering a press — derived, not stored.

    Pressing this raises the top level's limit, which changes the walk and re-runs the query; the
    rows arrive whenever they arrive, and on a slow space that is long enough for the press to look
    ignored. There is no "the query is running" signal to read: `local.<name>Loaded` latches true
    after the first answer and never goes back.

    So it is inferred from the two numbers already on screen. Inside this note `hidden > 0`, which
    means the level is full — so what has arrived is exactly the limit that was asked for, and the
    limit being LARGER than what has arrived can only mean the answer is still coming. It cannot
    stick: the same condition that hides the note when everything is shown also stops this being
    read. No flag to clear, and nothing to leave set if a query fails.
  */
  const pending = `local.${TOP_LIMIT} > count(${itemsExpr})`;

  return {
    type: '$if',
    props: {
      condition,
      then: {
        type: 'we-button',
        props: {
          // Words rather than a button — see the matching control in `discussionSection`.
          variant: 'bare',
          size: 'sm',
          ax: 'start',
          gap: '200',
          color: 'text-faint',
          hoverProps: { color: 'text' },
          py: '100',
          // Refuses a second press while the first is in flight. A list that grows by a page per
          // press is exactly the control somebody presses again when nothing happens, and the
          // second press would ask for two pages.
          disabled: { $: pending },
          // A page more of whatever the caller asked for at the top, so the step matches the shape
          // of the thread rather than a number chosen here.
          onClick: {
            $setLocal: TOP_LIMIT,
            value: { $: `local.${TOP_LIMIT} + ${(opts.perLevel ?? DEFAULT_PER_LEVEL)[0]}` },
          },
        },
        children: [
          'Show ',
          { type: 'we-number', props: { value: { $: hidden } } },
          { $: `plural(${hidden}, ' more reply', ' more replies')` },
          /*
            After the words, in the button's `end` slot.

            `we-button`'s own `loading` prop puts its spinner BEFORE the label, which is right for a
            button whose label is an action — "Save" with the work starting to its left. This is a
            line of text reporting a count, and the count is what changes when the press lands, so
            the wheel belongs where the sentence ends.
          */
          {
            type: '$if',
            props: {
              condition: { $: pending },
              then: { type: 'we-spinner', slot: 'end', props: { size: 'xs' } },
            },
          },
        ],
      },
    },
  };
}

/**
 * What the thread shows before its one query has answered.
 *
 * An empty `$each` and an unanswered one look identical, so without this a thread that is still
 * loading asserts "No replies yet" and then contradicts itself. Only at the top level, and only
 * before the first answer: `local.<name>Loaded` goes true and stays true, so this never returns
 * once the thread is live.
 *
 * Shaped like what is coming — a face, a byline, a line of words — rather than a spinner, so the
 * column does not jump when the replies land.
 *
 * `control-surface` rather than the primitive's own default: it fills with `surface-sunken`, which
 * is what an inspector panel is already painted in, so the placeholders were there and invisible.
 */
function threadSkeleton(opts: CommentThreadOptions): SchemaNode {
  const rows = Math.min(3, (opts.perLevel ?? DEFAULT_PER_LEVEL)[0]);
  return {
    type: 'Column',
    props: { width: '100%', gap: '300', py: '200' },
    children: Array.from({ length: rows }, () => ({
      type: 'Column',
      props: { width: '100%', gap: '100' },
      children: [
        {
          type: 'Row',
          props: { ay: 'center', gap: '200' },
          children: [
            { type: 'we-skeleton', props: { width: '24px', height: '24px', bg: 'control-surface' } },
            { type: 'we-skeleton', props: { width: '96px', height: '12px', bg: 'control-surface' } },
          ],
        },
        {
          type: 'Row',
          props: { width: '100%', gap: '200' },
          children: [
            { type: 'Column', props: { width: '24px', flexShrink: '0' } },
            { type: 'we-skeleton', props: { width: '100%', height: '12px', bg: 'control-surface' } },
          ],
        },
      ],
    })),
  };
}

/**
 * The thread's one subscription.
 *
 * Every shape this has taken is visible in what it is not. A query per *reply* cost a subscription
 * per row, and the level below cost one per row of that. A query per *level* fixed the count and
 * left the latency, since each level's anchors are the level above's answer — so three levels were
 * three sequential round trips and the tree assembled itself on screen. An unbounded transitive
 * read arrived at once and fetched a whole subtree to draw ten replies of it.
 *
 * The backend walks the levels itself, so this is one question: bounded at every depth, answered
 * once, on one subscription. Rows come back flat and each names its parent, which is what the
 * levels below filter on.
 */
function threadQueries(opts: CommentThreadOptions, depth: number): Record<string, QueryStateField> {
  // Trimmed to the drawn depth: a level nobody renders is a level nobody should pay for.
  const configured = (opts.perLevel ?? DEFAULT_PER_LEVEL).slice(0, depth);
  // The top level's breadth is the local, so pressing "show more" re-asks with a bigger number
  // instead of adding a second query beside the first.
  const levels: Array<number | Record<string, unknown>> = [{ $: `local.${TOP_LIMIT}` }, ...configured.slice(1)];
  return {
    [WHOLE_THREAD]: {
      entity: 'CollectionBlock',
      where: { author: { not: { $: 'spaceStore.mutedDids' } } },
      // The `comments` relation, drilled from the anchor. Untyped like `children`, so `scope` is
      // the only form available — `include` needs a known target class.
      scope: { anchor: 'CollectionBlock', via: 'comments', anchorId: opts.anchorId, levels },
      order: { createdAt: 'asc' },
      include: { ...THREAD_INCLUDE },
    },
  };
}

/**
 * Put the top level's breadth back to where it started.
 *
 * Exported for the same reason {@link foldToggle} is: the control that needs it belongs to the
 * caller. A thread that re-roots onto a reply is showing a different list, and "show me more of
 * this one" was about the list somebody was reading — not a standing preference to carry into every
 * branch they open afterwards. Reddit and every threaded reader work this way, and the alternative
 * compounds: open three branches after expanding once and each fetches the expanded number.
 *
 * Pass the same `perLevel` the thread was given, so the reset lands on the caller's own starting
 * point rather than this fragment's default.
 */
export function resetTopLimit(perLevel?: number[]): SchemaProp {
  return { $setLocal: TOP_LIMIT, value: (perLevel ?? DEFAULT_PER_LEVEL)[0] };
}

/**
 * Fold or unfold one reply — the handler behind a caret, wherever the caller draws one.
 *
 * Exported because the caret does not belong to this fragment. It reads best at the head of the
 * byline, before the face, which is the caller's row: a caret on a line of its own under the byline
 * is a whole row of chrome for one glyph, and on a folded branch it is the only row left. The state
 * stays here — an id in a set on the outermost thread — so what the caller gets is the press and the
 * expression that answers it, never the bookkeeping.
 */
export function foldToggle(as: string): SchemaProp {
  return { $toggleLocalIn: COLLAPSED, value: { $: `${as}.id` } };
}

/**
 * Hide a folded branch without tearing it down.
 *
 * `$animate` rather than `$if`, and the difference is a round trip: `$if` unmounts, which disposes
 * the nested thread's subscription and re-asks the backend on every expand — so a branch opened,
 * closed and opened again flashes empty each time. `$animate` keeps it mounted and closes the box.
 *
 * The cost, stated because it is real: a folded branch goes on holding its subscriptions. That is
 * the wrong trade on a thread of hundreds, and the place to revisit it is the deepest level, where
 * the subtree is largest and reopening it is rarest.
 */
function fold(opts: CommentThreadOptions, collapsed: string, node: SchemaNode): SchemaNode {
  if (!opts.collapsible) return node;
  return {
    type: '$animate',
    props: {
      condition: { $: `!(${collapsed})` },
      enterTransition: { type: 'reveal', duration: 200 },
    },
    children: [node],
  };
}

/**
 * How wide the rail's column is, and the gap after it.
 *
 * The width is an `xs` avatar (24px) and the gap is the one a compact byline puts between the face
 * and the name, because that is what the two numbers are *for*: the line falls under the middle of
 * the author's face, and a reply's own face starts where that author's name does. Nesting then reads
 * as a hanging indent from a person rather than as a series of margins.
 */
const RAIL_WIDTH = '24px';
const RAIL_GAP = '200';

/**
 * The rail — under the caret, beside the replies it gathers.
 *
 * A line descending from the head of a comment says *these are answers to it*, where a line to the
 * left of the whole comment only says how deep you are. It falls under the caret rather than the
 * face because the caret is what the line *is*: press either and the branch folds. A reply's own
 * caret then sits under its parent's face, which is the hanging indent this reads as.
 *
 * Only for a reply that has replies, so an ordinary comment sits at the full width of the thread
 * rather than one notch in from it. It stands down while the branch is folded — there is nothing
 * under it to trace, and the caret in the byline is the way back.
 */
function branchRail(as: string): SchemaNode {
  return {
    type: 'Column',
    props: { width: RAIL_WIDTH, flexShrink: '0', ax: 'center' },
    children: [
      /*
        The line, as a control.

        A press anywhere along a branch folds it, which is the affordance a border could not carry —
        and the hover band is what says so before the press. The line is a 1px column inside the
        button rather than the button's own border, so the target is the whole 24px and the mark is a
        hairline.
      */
      {
        type: 'we-button',
        props: {
          variant: 'bare',
          width: '100%',
          flex: '1',
          ax: 'center',
          label: 'Hide this branch',
          // Square, and flush with the segment above. A button's default radius curved both ends of
          // each half, so the one line showed exactly where it stopped being one.
          r: '0',
          ...railHighlight(),
          onClick: foldToggle(as),
        },
        children: [railLine()],
      },
    ],
  };
}

export function commentThread(opts: CommentThreadOptions): SchemaNode {
  const depth = opts.depth ?? 3;
  const level = opts.level ?? 1;
  const base = opts.as ?? 'reply';
  const asFor = (l: number) => (l === 1 ? base : `${base}${l}`);
  const as = asFor(level);
  /*
    The rows this level draws: those naming this level's parent — the anchor at the top, the reply
    above otherwise. One read puts every level in one local, so this is a filter rather than a query.
  */
  const parent = level === 1 ? anchorExpr(opts.anchorId) : `${asFor(level - 1)}.id`;
  const itemsExpr = `local.${WHOLE_THREAD}.filter(r, r.inReplyTo.id == ${parent})`;

  /** True while this reply is folded. One expression, read by the rail, the fold and the caller. */
  const collapsed = `${as}.id in local.${COLLAPSED}`;

  /*
    One level further in, anchored to this reply. At the limit, a count instead — a thread that
    simply stops looks finished, and someone who wrote the reply below it would never know.
  */
  const subtree: SchemaNode =
    level < depth
      ? commentThread({ ...opts, anchorId: { $: `${as}.id` }, level: level + 1 })
      : {
          type: '$if',
          props: {
            condition: { $: `count(${as}.comments)` },
            then: opts.more
              ? opts.more(as)
              : {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: [
                    { type: 'we-number', props: { value: { $: descendantCount(as) } } },
                    ' more in this thread',
                  ],
                },
          },
        };

  /*
    The row: the reply itself at the full width, and — where it has replies — the branch below it.

    The branch is a rail under the author's face with the replies beside it, so the indent is the
    rail's own column and the gap after it. A reply with none draws neither, which is what keeps an
    ordinary comment at the width of the thread rather than one notch in from it.
  */
  /*
    Whichever shape it takes, one row is ONE node.

    `$each` renders `children[0]` and drops the rest, silently: it is a template for a row, not a
    fragment of them. This was written as a list — the reply body, then the thread under it — so
    every level below the first was built, validated, and never mounted. The bug that surfaced it is
    the one it looks like from outside: a reply to a reply appeared nowhere, with no error, because
    nothing ever asked for that reply's own replies. `threadDepth.test.tsx` is the regression, and
    the validator now refuses a multi-child `$each` rather than dropping in silence.
  */
  const row: SchemaNode = opts.collapsible
    ? {
        type: 'Column',
        // No gap: the fold line crosses this seam, and 4px of air through the middle of it was the
        // other half of why one line looked like two.
        props: { width: '100%', gap: '0' },
        // Whose fold line the pointer is on. Here rather than deeper because the line's two halves
        // are in different branches of this row, and both have to read the one answer.
        $localState: { [RAIL_HOT]: { type: 'boolean', initial: false } },
        children: [
          ...opts.reply(as, collapsed),
          {
            type: '$if',
            props: {
              condition: { $: `count(${as}.comments)` },
              // The rail and what it gathers fold together: a line with nothing beside it is a mark
              // on empty space, and the caret in the byline is what brings both back.
              then: fold(opts, collapsed, {
                type: 'Row',
                props: { width: '100%', gap: RAIL_GAP, ay: 'stretch' },
                children: [
                  branchRail(as),
                  { type: 'Column', props: { flex: '1', minWidth: '0' }, children: [subtree] },
                ],
              }),
            },
          },
        ],
      }
    : { type: 'Column', props: { width: '100%', gap: '300' }, children: [...opts.reply(as, collapsed), subtree] };

  return {
    type: 'Column',
    props: {
      width: '100%',
      // Snug on purpose: a conversation is a run of short lines, and at a post's spacing a thread
      // reads as a column of separate things rather than as people answering each other. The byline
      // already separates one comment from the next — it does not need a band of air as well.
      gap: '200',
      ...(level > 1 && !opts.collapsible && { pl: opts.indent ?? '400' }),
    },
    // The folded ids, declared once at the top so a caret three levels down folds a branch the top
    // level is drawing. An inner declaration would shadow it, and each level would fold only itself.
    ...(level === 1
      ? {
          $localState: {
            [TOP_LIMIT]: { type: 'number', initial: (opts.perLevel ?? DEFAULT_PER_LEVEL)[0] },
            ...(opts.collapsible ? { [COLLAPSED]: { type: 'array', initial: [] } } : {}),
          },
        }
      : {}),
    ...(level === 1 ? { $queries: threadQueries(opts, depth) } : {}),
    children: [
      {
        type: '$if',
        props: {
          /*
            Ready, then counted. Testing the count alone cannot tell "nothing here" from "nothing
            yet", and the empty state says the first out loud.

            Two ways to be not-ready. The first is the obvious one: nothing has answered yet.
            The second is that something has, but for a different question — re-rooting the thread
            re-anchors the query, and `Loaded` is true for good once the first answer lands, so it
            cannot say that the rows in hand are the previous anchor's. Rows that exist and belong
            to nobody on screen are exactly that, and it is the only moment they can occur.
          */
          condition: {
            $:
              level === 1
                ? `local.${WHOLE_THREAD}Loaded && (count(${itemsExpr}) || !count(local.${WHOLE_THREAD}))`
                : 'true',
          },
          else: threadSkeleton(opts),
          then: {
            type: '$if',
            props: {
              condition: { $: `count(${itemsExpr})` },
              then: {
                type: 'Column',
                props: { width: '100%', gap: '200' },
                children: [
                  {
                    type: '$each',
                    props: { items: { $: itemsExpr }, as },
                    children: [row],
                  },
                  truncationNote(opts, level, itemsExpr),
                ],
              },
              ...(opts.empty && level === 1 && { else: opts.empty }),
            },
          },
        },
      },
    ],
  };
}

/** The reply count on a node, as a label — "4 replies". Reads the relation without loading it. */
export function replyCount(anchor: string): SchemaNode {
  return {
    type: '$if',
    // "0 replies" under every post in a quiet feed is a column of zeroes asserting nothing, and it
    // is the row's whole height. A count is worth showing once there is something to count.
    props: {
      condition: { $: `count(${anchor}.comments)` },
      then: {
        type: 'Row',
        props: { gap: '100', ay: 'center' },
        children: [
          { type: 'we-number', props: { value: { $: descendantCount(anchor) }, shorten: true } },
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint' },
            children: [{ $: `plural(${descendantCount(anchor)}, 'reply', 'replies')` }],
          },
        ],
      },
    },
  };
}

/** The house empty state for a thread nobody has replied to yet. */
export const noReplies = (): SchemaNode => emptyNote('No replies yet.');
