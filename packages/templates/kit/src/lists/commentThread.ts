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
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

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
  /** Internal: the current level, counted down. */
  level?: number;
}

/** Which replies are folded, by id — declared on the outermost thread. See `collapsible`. */
const COLLAPSED = 'collapsedReplies';

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
          hoverProps: { bg: 'surface-hover' },
          onClick: foldToggle(as),
        },
        children: [{ type: 'Column', props: { width: '1px', height: '100%', bg: 'border' } }],
      },
    ],
  };
}

export function commentThread(opts: CommentThreadOptions): SchemaNode {
  const depth = opts.depth ?? 3;
  const level = opts.level ?? 1;
  const as = level === 1 ? (opts.as ?? 'reply') : `${opts.as ?? 'reply'}${level}`;
  const key = `${as}Rows`;

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
                    { type: 'we-number', props: { value: { $: `count(${as}.comments)` } } },
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
        props: { width: '100%', gap: '100' },
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
      gap: '300',
      ...(level > 1 && !opts.collapsible && { pl: opts.indent ?? '400' }),
    },
    // The folded ids, declared once at the top so a caret three levels down folds a branch the top
    // level is drawing. An inner declaration would shadow it, and each level would fold only itself.
    ...(opts.collapsible && level === 1 ? { $localState: { [COLLAPSED]: { type: 'array', initial: [] } } } : {}),
    $queries: {
      [key]: {
        entity: 'CollectionBlock',
        where: { author: { not: { $: 'spaceStore.mutedDids' } } },
        // The `comments` relation, drilled from the anchor. Untyped like `children`, so `scope` is
        // the only form available — `include` needs a known target class.
        scope: { anchor: 'CollectionBlock', via: 'comments', anchorId: opts.anchorId },
        order: { createdAt: 'asc' },
        include: { signals: true },
      },
    },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: `count(local.${key})` },
          then: {
            type: 'Column',
            props: { width: '100%', gap: '300' },
            children: [
              {
                type: '$each',
                props: { items: { $: `local.${key}` }, as },
                children: [row],
              },
            ],
          },
          ...(opts.empty && level === 1 && { else: opts.empty }),
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
          { type: 'we-number', props: { value: { $: `count(${anchor}.comments)` }, shorten: true } },
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint' },
            children: [{ $: `plural(count(${anchor}.comments), 'reply', 'replies')` }],
          },
        ],
      },
    },
  };
}

/** The house empty state for a thread nobody has replied to yet. */
export const noReplies = (): SchemaNode => emptyNote('No replies yet.');
