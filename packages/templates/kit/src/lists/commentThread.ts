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
import type { SchemaNode } from '@we/schema-shared';

import { emptyNote } from '../states/emptyState.ts';
import type { AnchorId } from '../types.ts';

export interface CommentThreadOptions {
  /** Id of the node being replied to — a post, a block, or a reply one level up. */
  anchorId: AnchorId;
  /** Renders one reply. Receives the context key below. */
  reply: (as: string) => SchemaNode[];
  /** Context key for each reply. Defaults to `'reply'`; nested levels get `reply2`, `reply3`, … */
  as?: string;
  /** How many levels to expand. Defaults to 3. */
  depth?: number;
  /** Shown when a thread has no replies. Defaults to nothing — an empty thread should be silent. */
  empty?: SchemaNode;
  /** Indent per level, as a space token. Defaults to `'400'`. */
  indent?: string;
  /** Internal: the current level, counted down. */
  level?: number;
}

export function commentThread(opts: CommentThreadOptions): SchemaNode {
  const depth = opts.depth ?? 3;
  const level = opts.level ?? 1;
  const as = level === 1 ? (opts.as ?? 'reply') : `${opts.as ?? 'reply'}${level}`;
  const key = `${as}Rows`;

  const children: SchemaNode[] = [
    ...opts.reply(as),
    // One level further in, anchored to this reply. At the limit, a count instead — a thread that
    // simply stops looks finished, and someone who wrote the reply below it would never know.
    level < depth
      ? commentThread({ ...opts, anchorId: `$${as}.id`, level: level + 1 })
      : {
          type: '$if',
          props: {
            condition: { $count: { items: `$${as}.comments` } },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'neutral-400' },
              children: [
                { type: 'we-number', props: { value: { $count: { items: `$${as}.comments` } } } },
                ' more in this thread',
              ],
            },
          },
        },
  ];

  return {
    type: 'Column',
    props: { width: '100%', gap: '300', ...(level > 1 && { pl: (opts.indent ?? '400') }) },
    $queries: {
      [key]: {
        entity: 'CollectionBlock',
        where: { author: { not: { $store: 'spaceStore.mutedDids' } } },
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
          condition: { $count: { items: { $local: key } } },
          then: {
            type: 'Column',
            props: { width: '100%', gap: '300' },
            children: [{ type: '$each', props: { items: { $local: key }, as }, children }],
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
    type: 'Row',
    props: { gap: '100', ay: 'center' },
    children: [
      { type: 'we-number', props: { value: { $count: { items: `${anchor}.comments` } }, shorten: true } },
      {
        type: 'we-text',
        props: { variant: 'footnote', color: 'neutral-400' },
        children: [
          { $plural: { count: { $count: { items: `${anchor}.comments` } }, one: 'reply', other: 'replies' } },
        ],
      },
    ],
  };
}

/** The house empty state for a thread nobody has replied to yet. */
export const noReplies = (): SchemaNode => emptyNote('No replies yet.');
