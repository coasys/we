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
import type { SchemaNode } from '@we/schema-shared';

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
 * The caret and the rail, in a column of their own down the left of a reply.
 *
 * Only for a reply that has replies: a leaf has nothing to fold, so it gets the width and no
 * controls — the gutter is the indent as well as the affordance, and a leaf that lost it would sit
 * further left than its siblings.
 *
 * The rail stands down while the branch is folded. There is nothing under it to trace, and leaving
 * it would draw a line alongside a single line of text.
 */
function gutter(as: string, collapsed: string): SchemaNode {
  const toggle = { $toggleLocalIn: COLLAPSED, value: { $: `${as}.id` } };
  return {
    type: '$if',
    props: {
      condition: { $: `count(${as}.comments)` },
      // A leaf keeps the width, so every reply at a level starts at the same place.
      else: { type: 'Column', props: { width: '20px', flexShrink: '0' } },
      then: {
        type: 'Column',
        props: { width: '20px', flexShrink: '0', ax: 'center', gap: '100' },
        children: [
          {
            type: 'we-tooltip',
            props: { content: { $: `(${collapsed}) ? 'Show this branch' : 'Hide this branch'` } },
            children: [
              {
                type: 'we-button',
                props: {
                  variant: 'ghost',
                  size: 'xs',
                  square: true,
                  color: 'text-faint',
                  label: 'Fold this branch',
                  onClick: toggle,
                },
                children: [
                  { type: 'we-icon', props: { name: { $: `(${collapsed}) ? 'caret-right' : 'caret-down'` } } },
                ],
              },
            ],
          },
          /*
            The line, as a control.

            A press anywhere along a branch folds it, which is the affordance a border could not
            carry — and the hover band is what says so before the press. The line itself is a 1px
            column inside the button rather than the button's own border, so the target is the whole
            gutter and the mark is a hairline.
          */
          {
            type: '$if',
            props: {
              condition: { $: `!(${collapsed})` },
              then: {
                type: 'we-button',
                props: {
                  variant: 'bare',
                  width: '100%',
                  flex: '1',
                  ax: 'center',
                  label: 'Hide this branch',
                  hoverProps: { bg: 'surface-hover' },
                  onClick: toggle,
                },
                children: [{ type: 'Column', props: { width: '1px', height: '100%', bg: 'border' } }],
              },
            },
          },
        ],
      },
    },
  };
}

export function commentThread(opts: CommentThreadOptions): SchemaNode {
  const depth = opts.depth ?? 3;
  const level = opts.level ?? 1;
  const as = level === 1 ? (opts.as ?? 'reply') : `${opts.as ?? 'reply'}${level}`;
  const key = `${as}Rows`;

  /*
    One row is ONE node — the reply, and the thread hanging off it, inside a single box.

    `$each` renders `children[0]` and drops the rest, silently: it is a template for a row, not a
    fragment of them. This was written as a list — the reply body, then the thread under it — so
    every level below the first was built, validated, and never mounted. The bug that surfaced it is
    the one it looks like from outside: a reply to a reply appeared nowhere, with no error, because
    nothing ever asked for that reply's own replies.

    `threadDepth.test.tsx` is the regression, and the renderer now warns rather than dropping in
    silence — see `semanticValidation`.
  */
  /** True while this reply is folded. One expression, read by the gutter, the fold and the caller. */
  const collapsed = `${as}.id in local.${COLLAPSED}`;

  const body: SchemaNode[] = [
    ...opts.reply(as, collapsed),
    // One level further in, anchored to this reply. At the limit, a count instead — a thread that
    // simply stops looks finished, and someone who wrote the reply below it would never know.
    level < depth
      ? fold(opts, collapsed, commentThread({ ...opts, anchorId: { $: `${as}.id` }, level: level + 1 }))
      : fold(opts, collapsed, {
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
        }),
  ];

  /*
    The row: a gutter down the left holding the caret and the rail, and everything else beside it.

    The gutter is also the indent — a nested thread sits inside the right-hand column, so its own
    gutter offsets it from its parent and `pl` would be that offset twice. Without `collapsible`
    there is no gutter and `pl` is the indent, as it was.
  */
  const row: SchemaNode = opts.collapsible
    ? {
        type: 'Row',
        props: { width: '100%', gap: '200', ay: 'stretch' },
        children: [
          gutter(as, collapsed),
          { type: 'Column', props: { flex: '1', minWidth: '0', gap: '300' }, children: body },
        ],
      }
    : { type: 'Column', props: { width: '100%', gap: '300' }, children: body };

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
