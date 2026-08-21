/**
 * A rail of channels, optionally grouped into categories, with an unread dot on each.
 *
 * The Discord-shaped navigation, and the first fragment to use all three of the substrate pieces
 * together: containment (`kind: 'category'` collections holding `kind: 'channel'` ones), the
 * read-marker seen-state, and a `scope` drill-down per group.
 *
 * ## Why the nesting is fixed at two levels
 *
 * Categories hold channels; channels hold messages. The fragment does not recurse further, even
 * though `CollectionBlock` nests arbitrarily, because a navigation rail that can be five levels
 * deep is a file tree — a different component with different affordances (expansion state,
 * keyboard traversal, virtualisation) and none of them expressible as arrangement. A template that
 * genuinely wants a tree should reach for `GraphView` with a `tree` layout.
 *
 * ## Unread
 *
 * A channel is unread when its newest child is newer than this agent's marker for it, both ISO-8601
 * UTC strings compared with `$gt` — which works only because that format's lexicographic order is
 * chronological (see `ReadMarker.lastReadAt`). A channel with no marker has never been opened, so
 * anything in it is unread; `$gt` against `undefined` is false, so that case is handled explicitly
 * rather than falling out.
 *
 * The newest child comes from a `$latest` projection on the query rather than a second fetch — one
 * query answers the whole rail, including the dots.
 */
import type { AnchorId } from '@we/schema-kit';
import type { SchemaNode } from '@we/schema-shared';

export interface ChannelRailOptions {
  /** Route to navigate to, with `:id` replaced by the channel id. E.g. `'/channel/'`. */
  hrefPrefix: string;
  /** Which route segment holds the active channel id, for highlighting. Defaults to `1`. */
  activeSegment?: number;
  /** Group channels under `kind: 'category'` collections. Defaults to false — one flat list. */
  categories?: boolean;
  /** Node rendered under the rail — a "new channel" button, usually. */
  footer?: SchemaNode;
  /** Shown when there are no channels at all. */
  empty: SchemaNode;
}

/**
 * The query for channels, either loose in the space or inside one category.
 *
 * `$latestChild` is a single-item projection over `children` — with `limit: 1` it unwraps to the
 * instance or null, so the dot can compare one timestamp without hydrating a channel's messages.
 */
const channelQuery = (anchorId?: AnchorId) => ({
  entity: 'CollectionBlock',
  where: { kind: 'channel' },
  order: { createdAt: 'asc' as const },
  include: { $latestChild: { from: 'children', order: { createdAt: 'desc' }, limit: 1 } },
  ...(anchorId !== undefined && {
    scope: { anchor: 'CollectionBlock', via: 'children', anchorId },
  }),
});

/** One channel row: name, unread dot, active highlight. */
function channelRow(opts: ChannelRailOptions, as: string): SchemaNode {
  /*
    This agent's marker for this row, looked up with `$find`.

    Not `{ $store: 'spaceStore.readMarkers.<id>' }`: `$store` resolves a *static* dot path, so a
    context ref inside one is taken literally and resolves to nothing — which would read as "never
    opened" and leave every channel permanently dotted.
  */
  const marker = {
    $find: {
      items: { $store: 'spaceStore.readMarkers' },
      where: { nodeId: `$${as}.id` },
      select: 'lastReadAt',
    },
  };

  const unread = {
    $and: [
      `$${as}.$latestChild`,
      {
        $or: [
          // Never opened — everything in it is new.
          { $not: marker },
          { $gt: [`$${as}.$latestChild.createdAt`, marker] },
        ],
      },
    ],
  };

  return {
    type: 'we-button',
    props: {
      variant: {
        $if: {
          condition: { $eq: [{ $store: `routeStore.segments.${opts.activeSegment ?? 1}` }, `$${as}.id`] },
          then: 'secondary',
          else: 'ghost',
        },
      },
      size: 'sm',
      width: '100%',
      ax: 'between',
      onClick: [
        { $action: 'routeStore.navigate', args: [{ $concat: [opts.hrefPrefix, `$${as}.id`] }] },
        // Opening a channel is what marks it read. Deliberately on the navigation rather than on
        // the feed's mount: a feed that marks on mount also marks on every re-render the router
        // does, and re-reading a channel you are already in would clear a dot you had not seen.
        { $action: 'spaceStore.markRead', args: [`$${as}.id`] },
      ],
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', minWidth: '0' },
        children: [
          { type: 'we-icon', props: { name: 'hash', color: 'textFaint' } },
          { type: 'we-text', props: { truncate: true }, children: [`$${as}.title`] },
        ],
      },
      {
        type: '$if',
        props: {
          condition: unread,
          then: {
            type: 'Column',
            props: { width: '8px', height: '8px', r: 'full', bg: 'accent', flex: '0 0 auto' },
          },
        },
      },
    ],
  };
}

export function channelRail(opts: ChannelRailOptions): SchemaNode {
  const flat: SchemaNode = {
    type: 'Column',
    props: { width: '100%', gap: '100' },
    $queries: { channelRows: channelQuery() },
    children: [
      {
        type: '$if',
        props: {
          condition: { $count: { items: { $local: 'channelRows' } } },
          then: {
            type: '$each',
            props: { items: { $local: 'channelRows' }, as: 'channel' },
            children: [channelRow(opts, 'channel')],
          },
          else: {
            // Only when the rail is flat: with categories on, "no channels" is per-category and the
            // rail as a whole may still have plenty.
            type: '$if',
            props: { condition: { $local: 'channelRowsLoaded' }, then: opts.empty },
          },
        },
      },
    ],
  };

  if (!opts.categories) {
    return {
      type: 'Column',
      props: { width: '100%', gap: '300' },
      children: [flat, ...(opts.footer ? [opts.footer] : [])],
    };
  }

  return {
    type: 'Column',
    props: { width: '100%', gap: '400' },
    $queries: {
      categoryRows: { entity: 'CollectionBlock', where: { kind: 'category' }, order: { createdAt: 'asc' } },
    },
    children: [
      /**
       * The ungrouped list, shown only while no category exists.
       *
       * It used to render unconditionally, above the groups, to stop a channel created before any
       * category from being invisible. The trouble is that its query has no scope, so it returns
       * *every* channel — and once a category existed, every channel in one appeared twice: once
       * loose at the top and again under its heading. Easy to miss reading the code and impossible
       * to miss looking at it.
       *
       * The honest fix is a query for "channels with no parent category", and that cannot be
       * written: it needs a filter on the *absence* of an incoming relation, which is
       * `relationFilters` in `AdapterCapabilities` — declared false by both adapters. So the
       * condition here is the closest expressible thing, and it covers the case the original
       * comment was worried about, because a channel created before any category exists is a
       * channel in a space with no categories.
       *
       * What it does not cover: a loose channel in a space that also has categories stays hidden.
       * Worth fixing when relation filters land; not worth showing every channel twice until then.
       */
      {
        type: '$if',
        props: { condition: { $not: { $count: { items: { $local: 'categoryRows' } } } }, then: flat },
      },
      {
        type: '$each',
        props: { items: { $local: 'categoryRows' }, as: 'category' },
        children: [
          {
            type: 'Column',
            props: { width: '100%', gap: '100' },
            $queries: { catChannelRows: channelQuery('$category.id') },
            children: [
              {
                type: 'we-text',
                props: { variant: 'footnote', uppercase: true, color: 'text-faint', letterSpacing: 'wide' },
                children: ['$category.title'],
              },
              {
                type: '$each',
                props: { items: { $local: 'catChannelRows' }, as: 'catChannel' },
                children: [channelRow(opts, 'catChannel')],
              },
            ],
          },
        ],
      },
      ...(opts.footer ? [opts.footer] : []),
    ],
  };
}
