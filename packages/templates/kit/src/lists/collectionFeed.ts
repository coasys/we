/**
 * A feed of collections — the shape every container-based surface turns out to be.
 *
 * A channel's messages, a space's posts, a playlist's videos, a board's columns: all of them are
 * "the `CollectionBlock`s of some kind, either inside a parent or loose in the space, newest or
 * oldest first, with something to say when there are none". `cardList` covers the card-grid version
 * of that; this covers the *scoped* version, where the rows belong to a specific parent and the
 * arrangement is the caller's.
 *
 * ## Three things it carries that a hand-written `$each` would not
 *
 * **The scope shape.** Drilling into a container means
 * `scope: { anchor: 'CollectionBlock', via: 'children', anchorId }`, ANDed with a `where` on kind.
 * `children` is an untyped relation, so `include` cannot be used and this is the only form that
 * works — knowledge worth encoding once rather than rediscovering per template.
 *
 * **The mute filter, unconditionally.** Every feed drops muted authors, and it is not optional. A
 * feed either carries that filter from its first use or the ones written later quietly do not, and
 * "the block list works everywhere except the profile grid" is precisely the failure a shared
 * fragment exists to prevent. See `spaceStore.mutedDids`.
 *
 * **The loaded gate.** A query-backed list is empty on its first frame and full a moment later, so
 * an empty state rendered without gating asserts "nothing here" about a list that has not answered
 * yet. Same reasoning as `cardList`'s skeleton branch.
 */
import type { QueryStateField, SchemaNode } from '@we/schema-shared';

import type { AnchorId } from '../types.ts';

import { loadMore } from './loadMore.ts';

export interface CollectionFeedOptions {
  /** `CollectionBlock.kind` to list — `'message'`, `'post'`, `'channel'`, whatever the template minted. */
  kind: string;
  /**
   * Id of the parent whose `children` these are. Omit for collections loose in the space.
   *
   * Usually a route segment (`{ $store: 'routeStore.segments.1' }`) or a `$each` context ref.
   */
  anchorId?: AnchorId;
  /** Context key for each row, as `$each`'s `as`. Also names the hoisted results (`<as>Rows`). */
  as: string;
  /** The row template, rendered once per collection. */
  children: SchemaNode[];
  /** Shown when the feed has loaded and holds nothing — see `emptyState`. */
  empty: SchemaNode;
  /** Shown while the first result set is outstanding. Omit for nothing. */
  loading?: SchemaNode;
  /**
   * Sort direction on `createdAt`. `'asc'` reads as a transcript (chat), `'desc'` as a feed
   * (timeline). Defaults to `'desc'`.
   *
   * Only `createdAt` — manual ordering waits for the AD4M CRDT ordering work, and a `position`
   * scalar written now would be a shape that design supersedes.
   */
  order?: 'asc' | 'desc';
  /** Extra `where` conditions, ANDed with the kind filter. */
  where?: Record<string, unknown>;
  /** Rows per page. Defaults to 30. Pass `null` to load everything and omit the button. */
  pageSize?: number | null;
  /** `include` passed through — signal projections, hydrated relations. */
  include?: Record<string, unknown>;
  /** Wrapper for the rows. Defaults to a plain gap-300 Column. */
  wrapper?: (children: SchemaNode[]) => SchemaNode;
}

const defaultWrapper = (children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { gap: '300', width: '100%' },
  children,
});

export function collectionFeed(opts: CollectionFeedOptions): SchemaNode {
  const key = `${opts.as}Rows`;
  const pageSize = opts.pageSize === undefined ? 30 : opts.pageSize;
  const paged = pageSize !== null;
  const sizeField = `${opts.as}PageSize`;

  const query: QueryStateField = {
    entity: 'CollectionBlock',
    where: {
      kind: opts.kind,
      ...opts.where,
      /*
        Muted authors, dropped in the query rather than after it.

        `$in` against a store array, negated. Filtering the rendered rows instead would make a
        page of twenty posts show fifteen whenever five were muted — the limit is applied by the
        backend, so anything removed afterwards is a hole in the page rather than a shorter list.
      */
      author: { not: { $store: 'spaceStore.mutedDids' } },
    },
    order: { createdAt: opts.order ?? 'desc' },
    ...(paged && { limit: { $local: sizeField } }),
    ...(opts.include && { include: opts.include }),
    ...(opts.anchorId !== undefined && {
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: opts.anchorId },
    }),
  } as QueryStateField;

  const rows: SchemaNode = {
    type: '$if',
    props: {
      condition: { $count: { items: { $local: key } } },
      then: opts.wrapper
        ? opts.wrapper([{ type: '$each', props: { items: { $local: key }, as: opts.as }, children: opts.children }])
        : defaultWrapper([
            { type: '$each', props: { items: { $local: key }, as: opts.as }, children: opts.children },
          ]),
      else: opts.empty,
    },
  };

  return {
    type: 'Column',
    props: { width: '100%', gap: '300' },
    ...(paged && { $localState: { [sizeField]: { type: 'number', initial: pageSize } } }),
    $queries: { [key]: query },
    children: [
      {
        type: '$if',
        props: {
          condition: { $local: `${key}Loaded` },
          then: rows,
          ...(opts.loading && { else: opts.loading }),
        },
      },
      ...(paged ? [loadMore({ field: sizeField, rowsLocal: key, pageSize })] : []),
    ],
  };
}
