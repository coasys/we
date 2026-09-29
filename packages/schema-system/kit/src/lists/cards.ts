/**
 * A list of cards, and the card in it.
 *
 * ## What these require from the surrounding template
 *
 * These are the kit's most scope-dependent fragments, so the contract is written down rather than
 * discovered: `cardShell` and `gridWrapper` read **`local.displayMode`** (`'compact' | 'expanded'
 * | 'grid'`) from an ancestor, and `cardList` *writes* its query results into `$local` under
 * `<as>Rows`. A template using them must declare `displayMode` somewhere above, and must not use
 * that derived name for anything else.
 *
 * Reading up the tree rather than taking a prop is deliberate: the display toggle belongs to the
 * page, and threading it through every list and every card would put a prop on each of them whose
 * only job is to be passed on. The cost is this paragraph, and a check at insert time when these
 * become insertable.
 */
import type { LocalStateField, QueryStateField, SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import { skeletonList } from '../states/skeletonList.ts';
import { loadMore } from './loadMore.ts';

export interface CardShellOptions {
  /** Nodes always visible regardless of display mode (compact header row) */
  header: SchemaNode[];
  /** Nodes shown in expanded/grid modes, wrapped in CollapsedContent */
  body: SchemaNode[];
  /** Override for modal content in grid mode; defaults to body */
  modalContent?: SchemaNode[];
  /**
   * maxHeight for CollapsedContent. Accepts a px string or a schema expression.
   * Defaults to grid→200px / other→100px.
   */
  maxHeight?: string | Record<string, unknown>;
  /**
   * Extra per-card state, merged into the card's own `$localState`.
   *
   * A card's controls live in `header`, which is a child of the node holding that declaration — so
   * a list that puts a delete confirmation or an edit modal in its header has nowhere else to
   * declare the flag driving it. Without this the flag is undeclared, and `$setLocal` warns to the
   * console and no-ops: the button renders, is clickable, and does nothing. Both of PostsList's
   * controls were in exactly that state.
   */
  localState?: Record<string, LocalStateField>;
  /**
   * Subscriptions the card holds — a call's transcript, what extraction wrote onto it. Declared on
   * the card so they can name the row (`call.id`), which nothing above the `$each` can.
   */
  queries?: Record<string, QueryStateField>;
  /**
   * What this card *is*, so it can be picked up and carried somewhere else.
   *
   * Given, never derived: this fragment is called from inside a `$each` and never sees the row's
   * name, so only the list knows whether a row is a `CollectionBlock` or a `Space` and which field
   * holds its id. One line per list, and every card in the route becomes a drag source.
   *
   * Leave `datasetKey` alone for anything in the space on screen — the receiver stamps it. See
   * `we-draggable`.
   */
  drag?: {
    entity: SchemaProp;
    id: SchemaProp;
    label?: SchemaProp;
    icon?: SchemaProp;
    /** Only where the row is not in the dataset being looked at — a space listed in a directory. */
    datasetKey?: SchemaProp;
    /**
     * What this row was drawn with, so the ghost can draw the same card and a receiver can keep it.
     *
     * Every field is a property the list **already selected** — `post.editorState` is the same
     * string the card body renders — so filling this costs a property assignment, not a query. Give
     * what the row has and omit the rest: a picture where there is one, the composed document where
     * the content itself is the picture.
     */
    preview?: {
      thumbnail?: SchemaProp;
      content?: SchemaProp;
      author?: SchemaProp;
      date?: SchemaProp;
    };
  };
}

const defaultMaxHeight = { $: "local.displayMode == 'grid' ? '250px' : '100px'" };

/**
 * Generates a card node with per-item expand/modal state for use inside $each.
 *
 * - compact: header only
 * - expanded: header + CollapsedContent that expands inline
 * - grid: header + CollapsedContent where expand opens a modal
 *
 * $local reads inside body/modal resolve up the ancestor tree, so route-level
 * $localState (displayMode, sortDirection, etc.) remains accessible.
 */
export function cardShell(opts: CardShellOptions): SchemaNode {
  const card = buildCard(opts);
  if (!opts.drag) return card;
  /*
    Wrapped rather than given props of its own, because `we-draggable` is `display: contents`: it
    adds no box, so the card is still the grid item its parent lays out, and the card is what the
    ghost and the geometry are measured from.
  */
  return {
    type: 'we-draggable',
    props: {
      entity: opts.drag.entity,
      recordId: opts.drag.id,
      ...(opts.drag.label !== undefined && { label: opts.drag.label }),
      ...(opts.drag.icon !== undefined && { icon: opts.drag.icon }),
      ...(opts.drag.datasetKey !== undefined && { datasetKey: opts.drag.datasetKey }),
      ...(opts.drag.preview && { preview: opts.drag.preview }),
    },
    children: [card],
  };
}

function buildCard(opts: CardShellOptions): SchemaNode {
  const { header, body, modalContent } = opts;
  const maxHeight = opts.maxHeight ?? defaultMaxHeight;

  return {
    ...(opts.queries && { $queries: opts.queries }),
    $localState: {
      expanded: { type: 'boolean', initial: false },
      modalOpen: { type: 'boolean', initial: false },
      ...opts.localState,
    },
    type: 'Card',
    props: {
      bg: 'surface',
      border: '1px solid border',
      width: '100%',
    },
    children: [
      // Always-visible compact header
      ...header,

      // Body: expanded = full content; compact/grid = height-constrained with fade
      {
        type: '$if',
        props: {
          condition: { $: "local.displayMode == 'expanded'" },
          then: {
            type: 'Column',
            props: { gap: '300' },
            children: body,
          },
          else: {
            type: 'CollapsedContent',
            props: {
              maxHeight,
              collapsed: { $: '!local.expanded' },
              icon: { $: "local.displayMode == 'grid' ? 'arrows-out' : null" },
              onExpandClick: {
                $if: {
                  condition: { $: "local.displayMode == 'grid'" },
                  then: { $setLocal: 'modalOpen', value: true },
                  else: { $toggleLocal: 'expanded' },
                },
              },
            },
            children: [{ type: 'Column', props: { gap: '300' }, children: body }],
          },
        },
      },

      // Grid-expand modal
      {
        type: '$if',
        props: {
          condition: { $: 'local.modalOpen' },
          then: {
            type: 'we-modal',
            // `lg`: this is a card opened out to be read, so it wants the measure a page of content
            // wants. With no size at all it was as wide as its longest line — which for a grid card
            // holding a paragraph meant the expanded view could come out narrower than the tile.
            props: { size: 'lg', close: { $setLocal: 'modalOpen', value: false } },
            children: [
              {
                type: 'Column',
                props: { gap: '400' },
                children: modalContent ?? body,
              },
            ],
          },
        },
      },
    ],
  };
}

/**
 * Grid wrapper switching 1 ↔ 3 columns on displayMode. Internal: after the cardList conversion no
 * template calls it directly, and an export nobody calls is vocabulary noise once fragments are
 * things the marketplace lists.
 */
const gridWrapper = (children: SchemaNode[]): SchemaNode => ({
  type: 'Grid',
  props: {
    gap: '400',
    width: '100%',
    columns: { $: "local.displayMode == 'grid' ? 3 : 1" },
  },
  children,
});

export interface CardListOptions {
  /**
   * The rows, as a query run once for the whole list. Hoisted to the list's own node via
   * `$queries` rather than left on the `$each`, because the count has to be readable from outside
   * the loop to decide whether the loop renders at all — and hoisting means one subscription
   * answers both, so the placeholder can never disagree with the grid about how many rows there are.
   */
  query?: QueryStateField;
  /** Rows that are already an array — a store accessor or a `$filter` over one. Use instead of `query`. */
  items?: SchemaProp;
  /** Context key for each row, as `$each`'s `as`. Also names the hoisted results (`<as>Rows`). */
  as: string;
  /** The card template, rendered once per row. */
  children: SchemaNode[];
  /** Shown in place of the grid when there are no rows — see `emptyState`. */
  empty: SchemaNode;
  /**
   * How many rows to read at a time, with a "Load more" under the grid — `null` for all of them.
   *
   * Defaults to a page, and that default is the point: a query-backed list of a space's content
   * grows without bound, and unbounded it re-read, re-hydrated and re-fingerprinted every row of
   * every post in the space on every change. A feed is read from the top, so a page of it is what
   * anybody actually looks at.
   *
   * `null` is for a list whose completeness is load-bearing rather than for a long one — a
   * vocabulary, a set of folders, anything where showing some of it would be wrong rather than
   * merely shorter. Say so explicitly, so the decision is visible at the call site.
   */
  pageSize?: number | null;
}

/** Rows per page where a caller says nothing — a screenful and a bit, at either column count. */
const DEFAULT_PAGE = 24;

/**
 * One content type's list: a grid of cards, or a placeholder saying why there isn't one.
 *
 * Every section of the cards route is this shape, and before this they were this shape *minus the
 * placeholder* — an empty `$each` renders nothing at all, so a type with no content produced a page
 * with a header and blank space under it, indistinguishable from one still loading.
 *
 * The empty branch is a sibling of the grid rather than something inside it, because `gridWrapper`
 * lays out cards in up to three columns: a placeholder rendered as a grid child would sit in the
 * first column with two empty ones beside it.
 */
export function cardList(opts: CardListOptions): SchemaNode {
  const key = `${opts.as}Rows`;
  const items = opts.query ? { $: `local.${key}` } : opts.items;

  const list: SchemaNode = {
    type: '$if',
    props: {
      condition: expr`count(${items})`,
      then: gridWrapper([{ type: '$each', props: { items, as: opts.as }, children: opts.children }]),
      else: opts.empty,
    },
  };

  if (!opts.query) return list;

  /*
    Paged unless the caller says otherwise — see `pageSize`.

    The size lives in a `$localState` number the query's `limit` reads, so "load more" is one
    `$setLocal` and the subscription re-asks for a longer page. Bounding it matters more than it
    looks: this is the shape every section of the cards route uses, so one unbounded default is
    every content type in the space read whole on every change.
  */
  /*
    A limit the caller wrote wins, and takes the paging with it.

    A list that named its own bound has already decided how much it wants — the recorded-calls list
    asks for twenty — and quietly replacing that with a page would be this fragment overruling a
    decision it cannot see the reason for. The default is for the lists that said nothing, which are
    the ones that were unbounded.
  */
  const declared = (opts.query as Record<string, unknown>).limit !== undefined;
  // `??` would be wrong here: `null` is the caller explicitly asking for all of them, and nullish
  // coalescing would read that as "said nothing" and hand back the default page.
  const pageSize = declared || opts.pageSize === null ? null : (opts.pageSize ?? DEFAULT_PAGE);
  const sizeField = `${opts.as}PageSize`;
  const query = pageSize === null ? opts.query : { ...opts.query, limit: { $: `local.${sizeField}` } };

  // A query-backed list holds a skeleton until `<key>Loaded` flips — before the
  // first result set, "no rows yet" and "no rows" are different facts, and the
  // empty state must only ever assert the second.
  return {
    type: 'Column',
    props: { width: '100%' },
    ...(pageSize !== null && { $localState: { [sizeField]: { type: 'number', initial: pageSize } } }),
    $queries: { [key]: query as QueryStateField },
    children: [
      {
        type: '$if',
        props: { condition: { $: `local.${key}Loaded` }, then: list, else: skeletonList() },
      },
      ...(pageSize === null ? [] : [loadMore({ field: sizeField, rowsLocal: key, pageSize })]),
    ],
  };
}
