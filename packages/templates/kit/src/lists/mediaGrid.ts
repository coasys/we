/**
 * A grid of media — the Instagram/YouTube shape over the same posts a feed renders as a timeline.
 *
 * Deliberately reads the *same* collections a `collectionFeed` would: it does not need its own
 * content type, because "a post with a picture in it" and "a photo" are the same record seen two
 * ways. That is the point of the triptych demo — switch the template, keep the space, and the
 * timeline becomes a grid.
 *
 * ## Finding the media inside the post
 *
 * A post's images are `ImageBlock` children of its root collection, so each tile needs one image
 * out of a collection it does not otherwise render. That is a `$firstImage` single-item projection
 * on the query: `{ from: 'children', where: {...}, limit: 1 }` unwraps to the instance or null, so
 * one query yields both the posts and their cover images without a fetch per tile.
 *
 * Posts holding no image are dropped rather than shown as blank tiles — a grid is a promise that
 * every cell is a picture. They remain visible in any feed over the same data, which is the honest
 * behaviour: the template is a lens, not a filter on what exists.
 */
import type { AnchorId } from '@we/schema-kit';
import type { QueryStateField, SchemaNode, SchemaProp } from '@we/schema-shared';

export interface MediaGridOptions {
  /** `CollectionBlock.kind` to draw from. Usually `'post'`. */
  kind: string;
  /** Restrict to one author — a profile grid. Omit for everything in the space. */
  author?: SchemaProp;
  /** Id of a parent collection whose children to draw from — a playlist, an album. */
  anchorId?: AnchorId;
  /** What each tile does when clicked. Receives the context key. */
  onTileClick?: (as: string) => unknown;
  /** Context key for each row. Defaults to `'media'`. */
  as?: string;
  /** Minimum tile width, driving the responsive column count. Defaults to `'220px'`. */
  minTileWidth?: string;
  /** Shown when nothing in scope has an image. */
  empty: SchemaNode;
  /** Extra nodes drawn over each tile — a signal count, a play badge. Receives the context key. */
  overlay?: (as: string) => SchemaNode[];
}

export function mediaGrid(opts: MediaGridOptions): SchemaNode {
  const as = opts.as ?? 'media';
  const key = `${as}Rows`;

  const query = {
    entity: 'CollectionBlock',
    where: {
      kind: opts.kind,
      author: {
        // The mute filter, as unconditional here as in `collectionFeed` — a grid is a feed with a
        // different arrangement, and a block list that works in one view and not the other is
        // worse than none.
        not: { $store: 'spaceStore.mutedDids' },
        ...(opts.author !== undefined && { eq: opts.author }),
      },
    },
    order: { createdAt: 'desc' },
    limit: 60,
    include: {
      $firstImage: { from: 'children', limit: 1 },
      signals: true,
    },
    ...(opts.anchorId !== undefined && {
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: opts.anchorId },
    }),
  } as QueryStateField;

  return {
    type: 'Column',
    props: { width: '100%' },
    $queries: { [key]: query },
    children: [
      {
        type: '$if',
        props: {
          condition: { $count: { items: { $local: key } } },
          then: {
            type: 'Grid',
            props: { minChildWidth: opts.minTileWidth ?? '220px', gap: '200', width: '100%' },
            children: [
              {
                type: '$each',
                props: { items: { $local: key }, as },
                children: [
                  {
                    // Only rows that actually carry an image. A blank tile in a photo grid reads as
                    // a broken image, not as a post without one.
                    type: '$if',
                    props: {
                      condition: `$${as}.$firstImage.src`,
                      then: {
                        // `bare` rather than `ghost`: the tile supplies its own affordance, and
                        // ghost's hover background would paint a rectangle over the picture.
                        type: 'we-button',
                        props: {
                          variant: 'bare',
                          width: '100%',
                          ...(opts.onTileClick && { onClick: opts.onTileClick(as) }),
                        },
                        children: [
                          {
                            type: 'Column',
                            props: { position: 'relative', width: '100%', r: '300', overflow: 'hidden' },
                            children: [
                              {
                                type: 'we-image',
                                props: {
                                  src: `$${as}.$firstImage.src`,
                                  alt: `$${as}.$firstImage.altText`,
                                  fit: 'cover',
                                  loading: 'lazy',
                                  width: '100%',
                                  // Square tiles: a grid of mixed aspect ratios reads as a mistake,
                                  // and cropping is what every photo grid does.
                                  styles: { 'aspect-ratio': '1 / 1' },
                                },
                              },
                              ...(opts.overlay
                                ? [
                                    {
                                      type: 'Row',
                                      props: {
                                        position: 'absolute',
                                        bottom: '0',
                                        left: '0',
                                        right: '0',
                                        p: '200',
                                        gap: '300',
                                        ay: 'center',
                                        color: 'on-inverse',
                                        styles: {
                                          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                                        },
                                      },
                                      children: opts.overlay(as),
                                    },
                                  ]
                                : []),
                            ],
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
          else: { type: '$if', props: { condition: { $local: `${key}Loaded` }, then: opts.empty } },
        },
      },
    ],
  };
}
